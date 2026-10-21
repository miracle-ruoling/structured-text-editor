"""Edit explicit selection exceptions without changing other paragraphs' membership."""

from collections import Counter

from .expressions import parse_expression, references
from .models import Condition, PointChange, Selector
from .selectors import matches, select


def combine(kind, nodes):
    neutral = kind == "and"
    kept = []
    for node in nodes:
        if node == ("const", not neutral):
            return node
        if node != ("const", neutral):
            kept.extend(terms(node, kind))
    if not kept:
        return ("const", neutral)
    result = kept[0]
    for node in kept[1:]:
        result = (kind, result, node)
    return result


def terms(node, kind):
    return terms(node[1], kind) + terms(node[2], kind) if node[0] == kind else [node]


def replace(node, key, value):
    if node[0] == "ref":
        return value if node[1] == key else node
    if node[0] == "const":
        return node
    if node[0] == "not":
        child = replace(node[1], key, value)
        return ("const", not child[1]) if child[0] == "const" else ("not", child)
    return combine(node[0], [replace(child, key, value) for child in node[1:]])


def counts(node):
    if node[0] == "ref":
        return Counter([node[1]])
    if node[0] == "const":
        return Counter()
    return sum((counts(child) for child in node[1:]), Counter())


def expression(node, parent=0):
    if node[0] == "ref":
        return "$" + node[1]
    priority = {"or": 1, "and": 2, "not": 3}[node[0]]
    text = ("NOT " + expression(node[1], priority)) if node[0] == "not" else (
        f" {node[0].upper()} ".join(expression(child, priority) for child in terms(node, node[0]))
    )
    return "(" + text + ")" if priority < parent else text


def as_selector(tree, conditions):
    if tree[0] == "const":
        return Selector(mode="all" if tree[1] else "any")
    for kind, mode in (("and", "all"), ("or", "any")):
        leaves = terms(tree, kind)
        if all(n[0] == "ref" for n in leaves) and len(leaves) == len(conditions) and {
            n[1] for n in leaves
        } == set(conditions):
            return Selector(mode=mode, conditions=list(conditions.values()))
    return Selector(mode="expression", conditions=list(conditions.values()), expression=expression(tree))


def safe_parts(tree, conditions):
    """Only reuse root exclusions and union arms occurring once, never references under NOT."""
    uses = counts(tree)

    def eligible(node, op):
        return node[0] == "ref" and uses[node[1]] == 1 and (
            conditions[node[1]].field == "ids" and conditions[node[1]].op == op
        )

    negatives, rest = [], []
    for node in terms(tree, "and"):
        (negatives if eligible(node, "is_not") else rest).append(node)
    body = combine("and", rest)
    positives = [node for node in terms(body, "or") if eligible(node, "is")]
    return body, positives, negatives


def adjust_selection(blocks: list[dict], selector: Selector, changes: list[PointChange]) -> tuple[Selector, list[str]]:
    # Validate the original scopes before an OR exception could bypass a broken reference.
    select(blocks, selector)
    if any(not isinstance(c, Condition) for c in selector.conditions):
        raise ValueError("点选微调暂不支持旧接口的嵌套条件组，请先使用高级表达式。")
    conditions = {}
    reserved = {c.key for c in selector.conditions if c.key}
    if selector.mode == "expression":
        reserved |= references(parse_expression(selector.expression))

    def next_key():
        number = 0
        while True:
            index, key = number, ""
            while True:
                key = chr(65 + index % 26) + key
                index = index // 26 - 1
                if index < 0:
                    break
            if key not in reserved:
                reserved.add(key)
                return key
            number += 1

    for item in selector.conditions:
        condition = item.model_copy(deep=True)
        condition.key = condition.key or next_key()
        conditions[condition.key] = condition
    tree = parse_expression(selector.expression) if selector.mode == "expression" else combine(
        "and" if selector.mode == "all" else "or", [("ref", key) for key in conditions]
    )
    by_id = {b["id"]: b for b in blocks}
    for change in changes:
        if tree[0] == "const":
            conditions.clear()
        block = by_id.get(change.id)
        if block is None or not block.get("editable", True):
            raise ValueError("只能点选当前文档存在且可编辑的段落：" + change.id)
        current = as_selector(tree, conditions)
        if matches(block, current) == change.selected:
            continue
        body, positives, negatives = safe_parts(tree, conditions)
        # First undo the opposite explicit exception, preserving unrelated boolean terms.
        for node in negatives if change.selected else positives:
            key = node[1]
            ids = [i for i in conditions[key].ids if i != change.id]
            if ids:
                conditions[key] = conditions[key].model_copy(update={"ids": ids})
            else:
                tree = replace(tree, key, ("const", change.selected))
                del conditions[key]
        if matches(block, as_selector(tree, conditions)) == change.selected:
            continue
        body, positives, negatives = safe_parts(tree, conditions)
        reusable = positives if change.selected else negatives
        if reusable:
            key = reusable[0][1]
            conditions[key] = conditions[key].model_copy(update={"ids": [*conditions[key].ids, change.id]})
        else:
            if len(conditions) >= 30:
                raise ValueError("最多 30 个条件，请先删除不需要的条件再点选。")
            key = next_key()
            conditions[key] = Condition(key=key, field="ids", op="is" if change.selected else "is_not", ids=[change.id])
            tree = combine("and", [combine("or", [body, ("ref", key)]), *negatives]) if change.selected else combine("and", [tree, ("ref", key)])
    result = as_selector(tree, conditions)
    return result, select(blocks, result)
