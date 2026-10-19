import pytest
from pydantic import ValidationError
from structured_editor.domain.models import Annotation, FormatPatch, Selector
from structured_editor.domain.selectors import select


def test_intersection_excludes_tables_and_tagged_exceptions():
    blocks = [
        {"id": "1", "role": "body", "tags": [], "in_table": False, "text": "正文"},
        {"id": "2", "role": "body", "tags": ["保留"], "in_table": False, "text": "例外"},
        {"id": "3", "role": "heading", "tags": [], "in_table": False, "text": "标题"},
        {"id": "4", "role": "body", "tags": [], "in_table": True, "text": "表格"},
    ]
    selector = Selector(
        conditions=[
            {"field": "role", "value": "body"},
            {"field": "tag", "op": "is_not", "value": "保留"},
            {"field": "context", "op": "is_not", "value": "table"},
        ]
    )
    assert select(blocks, selector) == ["1"]
    assert select(
        blocks,
        Selector(
            mode="any", conditions=[{"field": "tag", "value": "保留"}, {"field": "role", "value": "heading"}]
        ),
    ) == ["2", "3"]


def test_nested_selectors_and_empty_groups():
    blocks = [{"id": "1", "role": "body", "tags": ["a"], "in_table": False, "text": "Hello"}]
    selector = Selector(
        conditions=[
            {"mode": "any", "conditions": [{"field": "tag", "value": "a"}, {"field": "tag", "value": "b"}]},
            {"field": "text", "op": "contains", "value": "HELLO"},
        ]
    )
    assert select(blocks, selector) == ["1"]
    assert select(blocks, Selector()) == ["1"]
    assert select(blocks, Selector(mode="any")) == []
    blocks[0]["editable"] = False
    assert select(blocks, Selector()) == []


@pytest.mark.parametrize(
    "patch",
    [
        {"size_pt": 0},
        {"line_spacing": 0},
        {"font_latin": " "},
        {"size_pt": float("inf")},
        {"size_pt": 12.3},
        {"unknown": 1},
    ],
)
def test_invalid_format_is_rejected(patch):
    with pytest.raises(ValidationError):
        FormatPatch(**patch)


def test_tags_normalized_without_silently_truncating():
    assert Annotation(tags=[" a ", "a", "", "b"]).tags == ["a", "b"]
    with pytest.raises(ValidationError):
        Annotation(tags=["a" * 41])
