from .models import Condition, Selector


def matches(block: dict, selector: Selector | Condition) -> bool:
    if isinstance(selector, Selector):
        results = (matches(block, item) for item in selector.conditions)
        return all(results) if selector.mode == "all" else any(results)
    value = selector.value
    if selector.field == "role":
        result = block["role"] == value
    elif selector.field == "tag":
        result = value in block["tags"]
    elif selector.field == "context":
        result = bool(block["in_table"]) == (value == "table")
    else:
        actual = block["text"].casefold()
        result = value.casefold() in actual if "contains" in selector.op else actual == value.casefold()
    return not result if selector.op in ("is_not", "not_contains") else result


def select(blocks: list[dict], selector: Selector) -> list[str]:
    return [block["id"] for block in blocks if block.get("editable", True) and matches(block, selector)]
