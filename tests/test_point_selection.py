import random

import pytest
from structured_editor.domain.models import Condition, PointChange, Selector
from structured_editor.domain.point_selection import adjust_selection
from structured_editor.domain.selectors import select

BLOCKS = [
    {"id": f"p{i}", "role": "body" if i % 2 else "heading", "tags": ["x"] if i % 3 else [],
     "in_table": i > 4, "text": str(i), "editable": i != 9}
    for i in range(1, 10)
]


def change(selector, paragraph, selected):
    return adjust_selection(BLOCKS, selector, [PointChange(id=paragraph, selected=selected)])


@pytest.mark.parametrize("mode,expression", [
    ("all", ""), ("any", ""), ("expression", "NOT $A OR $B"),
    ("expression", "($A AND $B) OR NOT $C"),
    ("expression", "($A OR $C) AND (NOT $B OR NOT $C)"),
    ("expression", "$A AND ($C OR NOT $C)"),
])
def test_toggles_only_change_requested_membership(mode, expression):
    selector = Selector(mode=mode, expression=expression, conditions=[
        Condition(key="A", field="role", value="body"),
        Condition(key="B", field="tag", value="x"),
        Condition(key="C", field="ids", ids=["p1", "p2", "p4"]),
    ])
    original = selector.model_dump()
    expected = set(select(BLOCKS, selector))
    rng = random.Random(41)
    for _ in range(70):
        paragraph = f"p{rng.randint(1, 8)}"
        desired = paragraph not in expected
        if desired:
            expected.add(paragraph)
        else:
            expected.remove(paragraph)
        updated, ids = change(selector, paragraph, desired)
        assert set(ids) == expected
        assert selector.model_dump() == original
        # The canonical selector is ordinary persistable data, without hidden exceptions.
        selector = Selector.model_validate(updated.model_dump())
        original = selector.model_dump()
        assert len(selector.conditions) <= 5


def test_reuses_positive_and_negative_rows_across_separate_requests():
    selector = Selector(conditions=[Condition(field="role", value="body")])
    for paragraph in ["p2", "p4", "p6"]:
        selector, _ = change(selector, paragraph, True)
    positives = [c for c in selector.conditions if c.field == "ids" and c.op == "is"]
    assert len(positives) == 1 and positives[0].ids == ["p2", "p4", "p6"]
    selector, ids = change(selector, "p4", False)
    assert set(ids) == {"p1", "p2", "p3", "p5", "p6", "p7"}
    assert len(selector.conditions) == 2
    for paragraph in ["p1", "p3"]:
        selector, _ = change(selector, paragraph, False)
    negatives = [c for c in selector.conditions if c.field == "ids" and c.op == "is_not"]
    assert len(negatives) == 1 and negatives[0].ids == ["p1", "p3"]
    assert selector.mode == "expression"
    selector, ids = change(selector, "p1", True)
    assert "p1" in ids and "p3" not in ids
    assert next(c for c in selector.conditions if c.op == "is_not").ids == ["p3"]


def test_remove_last_point_never_selects_all_and_batch_respects_order():
    selector = Selector(conditions=[Condition(field="ids", ids=["p1"])])
    selector, ids = change(selector, "p1", False)
    assert ids == [] and selector.mode == "any" and selector.conditions == []
    selector, ids = adjust_selection(BLOCKS, selector, [
        PointChange(id="p2", selected=True), PointChange(id="p3", selected=True),
        PointChange(id="p2", selected=False), PointChange(id="p4", selected=True),
    ])
    assert ids == ["p3", "p4"] and len(selector.conditions) == 1
    selector, ids = change(Selector(), "p2", False)
    assert "p2" not in ids and len(ids) == 7
    selector, ids = change(selector, "p2", True)
    assert len(ids) == 8 and selector == Selector()


def test_unsafe_id_reference_is_not_rewritten():
    selector = Selector(mode="expression", expression="NOT $A OR $B", conditions=[
        Condition(key="A", field="ids", ids=["p1", "p2"]),
        Condition(key="B", field="role", value="body"),
    ])
    updated, ids = change(selector, "p2", True)
    assert updated.conditions[0] == selector.conditions[0]
    assert set(ids) == set(select(BLOCKS, selector)) | {"p2"}


def test_invalid_targets_scopes_and_limit_fail_atomically():
    selector = Selector(conditions=[Condition(field="chapter", value="p1")])
    with pytest.raises(ValueError, match="范围已不存在"):
        change(selector, "p2", True)
    for paragraph in ["p9", "p99"]:
        with pytest.raises(ValueError, match="存在且可编辑"):
            change(Selector(), paragraph, False)
    crowded = Selector(conditions=[Condition(field="role", value="body") for _ in range(30)])
    before = crowded.model_dump()
    with pytest.raises(ValueError, match="最多 30"):
        change(crowded, "p2", True)
    assert crowded.model_dump() == before


def test_endpoint_is_read_only_revision_checked_and_result_applies(client):
    doc = client.post("/api/projects/demo").json()
    url = f"/api/projects/{doc['id']}"
    before = client.get(url).json()
    export = client.get(url + "/export/docx").content
    request = {"revision": doc["revision"], "selector": {"mode": "any", "conditions": []},
               "changes": [{"id": "p3", "selected": True}, {"id": "p5", "selected": True}]}
    result = client.post(url + "/selection-adjust", json=request)
    assert result.status_code == 200, result.text
    assert result.json()["ids"] == ["p3", "p5"]
    assert client.get(url).json() == before
    assert client.get(url + "/export/docx").content == export
    stale = {**request, "revision": doc["revision"] + 1}
    assert client.post(url + "/selection-adjust", json=stale).status_code == 409
    response = client.post(url + "/apply", json={"revision": doc["revision"],
                           "selector": result.json()["selector"], "patch": {"italic": True}})
    assert response.status_code == 200, response.text
    after = response.json()
    for old, new in zip(before["blocks"], after["blocks"]):
        if old["id"] not in {"p3", "p5"}:
            assert new == old
