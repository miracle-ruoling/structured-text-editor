"""Explain page-break / keep-next conflicts without changing the requested format."""


def pagination_warnings(view: dict, touched: set[str]) -> list[str]:
    by_id = {b["id"]: b for b in view["blocks"]}
    conflicts = []

    def visit(nodes):
        previous = None
        for node in nodes:
            if node["kind"] == "paragraph":
                current = by_id.get(node["id"])
                if previous and current and touched.intersection((previous["id"], current["id"])):
                    if previous["format"].get("keep_next") and current["format"].get("page_break_before"):
                        conflicts.append((previous["id"], current["id"]))
                previous = current
            else:
                previous = None
                if node["kind"] == "table":
                    for row in node["rows"]:
                        for cell in row:
                            visit(cell["children"])
                else:
                    visit(node["children"])

    visit(view["layout"])
    if not conflicts:
        return []
    pairs = "、".join(f"{a.upper()} → {b.upper()}" for a, b in conflicts[:6])
    rest = f"等 {len(conflicts)} 处" if len(conflicts) > 6 else ""
    return [
        f"{pairs}{rest}：前段要求与下段同页，后段却要求另起一页，连排意图冲突。可关闭其中一项；仍可应用，最终分页由 Word 决定。"
    ]
