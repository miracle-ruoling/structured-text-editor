from .expressions import evaluate, parse_expression
from .models import Condition, Selector


def predicate(selector: Selector | Condition):
    if isinstance(selector, Selector):
        children = [predicate(item) for item in selector.conditions]
        if selector.mode == "expression":
            tree = parse_expression(selector.expression)
            keys = [item.key for item in selector.conditions]
            return lambda block: evaluate(tree, {key: fn(block) for key, fn in zip(keys, children)})
        combine = all if selector.mode == "all" else any
        return lambda block: combine(fn(block) for fn in children)
    value = selector.value
    ids = frozenset(selector.ids or [])

    def condition(block):
        result = leaf_matches(block, selector, value, ids)
        return not result if selector.op in ("is_not", "not_contains") else result

    return condition


def leaf_matches(block, selector, value, ids):
    if selector.field == "role":
        result = block["role"] == value
    elif selector.field == "tag":
        result = value in block["tags"]
    elif selector.field == "context":
        result = bool(block["in_table"]) == (value == "table")
    elif selector.field == "ids":
        result = block["id"] in ids
    else:
        actual = block["text"].casefold()
        result = value.casefold() in actual if "contains" in selector.op else actual == value.casefold()
    return result


def matches(block: dict, selector: Selector | Condition) -> bool:
    return predicate(selector)(block)


def select(blocks: list[dict], selector: Selector) -> list[str]:
    check = predicate(selector)
    return [block["id"] for block in blocks if block.get("editable", True) and check(block)]
