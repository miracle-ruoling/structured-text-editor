"""One-shot size changes freeze absolute results; they are never recursive rules."""

from bisect import bisect_left, bisect_right

from .models import SizeChange, SizeOverrides

CHINESE_SIZES = (5, 5.5, 6.5, 7.5, 9, 10.5, 12, 14, 15, 16, 18, 22, 24, 26, 36, 42)


def shifted_size(value: float | None, change: SizeChange, identity: str) -> float:
    if value is None:
        raise ValueError(f"{identity.upper()} 有无法解析的字号，无法可靠增减；请先为该范围设置绝对字号。")
    if change.mode == "points":
        result = value + change.amount
    else:
        steps = int(change.amount)
        index = (
            bisect_right(CHINESE_SIZES, value) + steps - 1
            if steps > 0
            else bisect_left(CHINESE_SIZES, value) + steps
        )
        if not 0 <= index < len(CHINESE_SIZES):
            raise ValueError(f"{identity.upper()} 的 {value:g} 磅超出本次中文字号增减范围；未修改任何段落。")
        result = CHINESE_SIZES[index]
    if not 1 <= result <= 200 or (result * 2) % 1:
        raise ValueError(
            f"{identity.upper()} 计算后字号为 {result:g} 磅，超出 1–200 磅/半磅步进；未修改任何段落。"
        )
    return result


def changed_sizes(block: dict, change: SizeChange) -> SizeOverrides:
    runs = {
        str(run["index"]): shifted_size(run["format"].get("size_pt"), change, block["id"])
        for run in block["runs"]
    }
    base = block.get("paragraph_size_pt")
    # Unknown paragraph-mark format does not invalidate known visible text sizes.
    paragraph = shifted_size(base, change, block["id"]) if base is not None or not runs else None
    return SizeOverrides(paragraph_pt=paragraph, runs=runs)


def project_sizes(block: dict, sizes: SizeOverrides):
    if sizes.paragraph_pt is not None:
        block["paragraph_size_pt"] = sizes.paragraph_pt
    for run in block["runs"]:
        if str(run["index"]) in sizes.runs:
            run["format"]["size_pt"] = sizes.runs[str(run["index"])]
    values = size_values(block)
    block["format"]["size_pt"] = values[0] if len(values) == 1 else None
    block["mixed"] = [key for key in block["mixed"] if key != "size_pt"]
    if len(values) > 1:
        block["mixed"].append("size_pt")


def size_values(block: dict) -> list:
    values = {run["format"].get("size_pt") for run in block["runs"]}
    if not values:
        values.add(block.get("paragraph_size_pt", block["format"].get("size_pt")))
    return sorted(values, key=lambda x: -1 if x is None else x)
