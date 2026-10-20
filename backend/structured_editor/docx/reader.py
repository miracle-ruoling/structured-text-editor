from .package import DocxPackage
from .styles import StyleResolver
from .xml import NS, own_runs, q, run_text, value

LOCKED_ANCESTORS = {q(n) for n in ("sdt", "txbxContent", "ins", "del", "moveFrom", "moveTo", "customXml")}


def is_editable(paragraph):
    if paragraph.getparent().tag not in (q("body"), q("tc")):
        return False
    if any(a.tag in LOCKED_ANCESTORS for a in paragraph.iterancestors()):
        return False
    return not any(
        paragraph.find(f".//w:{name}", NS) is not None
        for name in ("ins", "del", "moveFrom", "moveTo", "pPrChange", "rPrChange", "sdt")
    )


def project_document(package: DocxPackage) -> dict:
    styles = StyleResolver(package.styles, package.theme, package.settings, package.numbering)
    blocks, warnings = [], []
    section_ids, sections = physical_sections(package)
    for identity, paragraph in package.by_id.items():
        # Text boxes are preserved, but not represented twice inside their host paragraph.
        if any(a.tag == q("txbxContent") for a in paragraph.iterancestors()):
            continue
        fmt, sources, runs, mixed, sid, sname, role, reason, metadata = styles.paragraph(paragraph)
        text = "".join(run_text(run) for run in own_runs(paragraph))
        in_table = any(a.tag == q("tc") for a in paragraph.iterancestors())
        features = []
        if paragraph.find(".//w:drawing", NS) is not None or paragraph.find(".//w:pict", NS) is not None:
            features.append("图片 / 绘图（导出保留）")
        if paragraph.find(".//m:oMath", NS) is not None:
            features.append("公式（导出保留）")
        if paragraph.find(".//w:fldChar", NS) is not None or paragraph.find(".//w:fldSimple", NS) is not None:
            features.append("域（导出保留）")
        if paragraph.find(".//w:object", NS) is not None:
            features.append("嵌入对象（导出保留）")
        blocks.append(
            {
                "id": identity,
                "kind": "paragraph",
                "text": text,
                "runs": runs,
                "role": role,
                "tags": [],
                "in_table": in_table,
                "editable": is_editable(paragraph),
                "style_id": sid,
                "style_name": sname,
                "role_source": reason,
                "confirmed": False,
                "format": fmt,
                "format_sources": sources,
                "mixed": mixed,
                "features": features,
                "overrides": {},
                "section_id": section_ids[identity],
                **metadata,
            }
        )
    known = {b["id"] for b in blocks}

    def children(container):
        nodes = []
        for child in container:
            if child.tag == q("p"):
                identity = package.ids[child]
                if identity in known:
                    nodes.append({"kind": "paragraph", "id": identity})
            elif child.tag == q("tbl"):
                rows = []
                for row in child.findall(q("tr")):
                    cells = []
                    for cell in row.findall(q("tc")):
                        span = value(cell, "w:tcPr/w:gridSpan")
                        cells.append({"span": max(1, min(64, int(span or "1"))), "children": children(cell)})
                    rows.append(cells)
                nodes.append({"kind": "table", "rows": rows})
            elif child.tag != q("sectPr"):
                descendants = [package.ids[p] for p in child.iter(q("p")) if package.ids.get(p) in known]
                if descendants:
                    nodes.append(
                        {
                            "kind": "unsupported",
                            "label": "受保护的复杂结构 · 原样保留",
                            "children": [{"kind": "paragraph", "id": p} for p in descendants],
                        }
                    )
        return nodes

    if any(not b["editable"] for b in blocks):
        warnings.append("内容控件、修订等复杂结构中的段落仅供查看，不参与批量修改。")
    if any(b["features"] for b in blocks):
        warnings.append("图片、公式、域等以提示展示；原始对象会保留在导出的 Word 中。")
    if package.body.find(".//w:vMerge", NS) is not None:
        warnings.append("包含纵向合并单元格：结构视图分行展示，导出保留原有合并。")
    if package.body.find(".//w:txbxContent", NS) is not None:
        warnings.append("文本框内文字暂不参与筛选，导出原样保留。")
    if any(
        name.startswith(("word/header", "word/footer", "word/footnotes", "word/endnotes"))
        for name in package.archive.namelist()
    ):
        warnings.append("页眉、页脚、脚注与尾注不在本阶段的操作范围，导出原样保留。")
    if any(b["numbering"] for b in blocks):
        warnings.append("已读取编号定义与级别；阅读视图不重新计算自动编号，Word 导出保留原序列。")
    if any(
        b["format"].get(key) is None and key in b["format"] and key not in b["mixed"]
        for b in blocks
        for key in ("font_east_asia", "font_latin")
    ):
        warnings.append("部分主题字体引用未能解析，显示字体可能替代；原引用保留，相对字号不猜测未知值。")
    if package.styles is not None and package.styles.find(".//w:tblStylePr", NS) is not None:
        warnings.append("表格条件样式尚未完整计算；原 XML 保留，阅读视图为近似排版。")
    for section in sections:
        section["count"] = sum(b["section_id"] == section["id"] for b in blocks)
    return {"blocks": blocks, "layout": children(package.body), "warnings": warnings, "sections": sections}


def physical_sections(package):
    ids, sections, index = {}, [], 1
    for child in package.body:
        for paragraph in child.iter(q("p")):
            ids[package.ids[paragraph]] = f"sec{index}"
        boundary = (
            child.find("w:pPr/w:sectPr", NS)
            if child.tag == q("p")
            else child
            if child.tag == q("sectPr")
            else None
        )
        if boundary is not None:
            sections.append(
                {
                    "id": f"sec{index}",
                    "name": f"Word 第 {index} 节",
                    "break_type": value(boundary, "w:type") or "nextPage",
                    "width_pt": int(value(boundary, "w:pgSz", "w")) / 20
                    if value(boundary, "w:pgSz", "w")
                    else None,
                    "height_pt": int(value(boundary, "w:pgSz", "h")) / 20
                    if value(boundary, "w:pgSz", "h")
                    else None,
                }
            )
            index += 1
    if not sections or f"sec{index}" in ids.values():
        sections.append(
            {
                "id": f"sec{index}",
                "name": f"Word 第 {index} 节",
                "break_type": "nextPage",
                "width_pt": None,
                "height_pt": None,
            }
        )
    return ids, sections
