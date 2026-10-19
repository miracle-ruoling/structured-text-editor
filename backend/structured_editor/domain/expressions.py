"""Small Boolean language over condition references; never executes user code."""

import re
from functools import lru_cache

TOKEN = re.compile(r"\s*(\$[A-Z][A-Z0-9_]{0,15}|AND\b|OR\b|NOT\b|[()])", re.IGNORECASE)


@lru_cache(maxsize=256)
def parse_expression(expression: str) -> tuple:
    if not expression.strip():
        raise ValueError("请输入逻辑表达式，例如 $A AND NOT $B")
    if len(expression) > 2000:
        raise ValueError("逻辑表达式最多 2000 个字符")
    tokens, offset = [], 0
    while offset < len(expression):
        if not expression[offset:].strip():
            break
        match = TOKEN.match(expression, offset)
        if not match:
            raise ValueError(f"表达式第 {offset + 1} 个字符附近无效；只支持 $代号、AND、OR、NOT 和括号")
        tokens.append(match[1].upper())
        offset = match.end()
    if len(tokens) > 256:
        raise ValueError("表达式过长，请拆分为更简单的条件")
    position = 0

    def peek():
        return tokens[position] if position < len(tokens) else None

    def unary(depth):
        nonlocal position
        if depth > 32:
            raise ValueError("括号或 NOT 嵌套不能超过 32 层")
        token = peek()
        if token == "NOT":
            position += 1
            return ("not", unary(depth + 1))
        if token == "(":
            position += 1
            node = disjunction(depth + 1)
            if peek() != ")":
                raise ValueError("表达式缺少右括号 )")
            position += 1
            return node
        if token and token.startswith("$"):
            position += 1
            return ("ref", token[1:])
        raise ValueError("此处需要 $条件代号、NOT 或左括号")

    def conjunction(depth):
        nonlocal position
        node = unary(depth)
        while peek() == "AND":
            position += 1
            node = ("and", node, unary(depth))
        return node

    def disjunction(depth):
        nonlocal position
        node = conjunction(depth)
        while peek() == "OR":
            position += 1
            node = ("or", node, conjunction(depth))
        return node

    result = disjunction(0)
    if position != len(tokens):
        raise ValueError("表达式有多余内容；条件之间需要 AND 或 OR")
    return result


def references(node: tuple) -> set[str]:
    if node[0] == "ref":
        return {node[1]}
    return set().union(*(references(child) for child in node[1:]))


def evaluate(node: tuple, values: dict[str, bool]) -> bool:
    if node[0] == "ref":
        return values[node[1]]
    if node[0] == "not":
        return not evaluate(node[1], values)
    if node[0] == "and":
        return evaluate(node[1], values) and evaluate(node[2], values)
    return evaluate(node[1], values) or evaluate(node[2], values)
