import io
import itertools
import json
import zipfile

import pytest
from lxml import etree
from pydantic import ValidationError
from structured_editor.docx.package import DocxPackage
from structured_editor.domain.expressions import parse_expression
from structured_editor.domain.models import Selector
from structured_editor.domain.selectors import select
from structured_editor.storage import ProjectStore


def expression(value, conditions=None):
    return {
        "mode": "expression",
        "expression": value,
        "conditions": conditions or [{"key": key, "field": "tag", "value": key} for key in ("A", "B", "C")],
    }


def scope(*ids):
    return {"conditions": [{"field": "ids", "ids": list(ids)}]}


def test_boolean_truth_tables_and_precedence():
    blocks = [
        {"id": str(i), "tags": [k for k, v in zip("ABC", row) if v]}
        for i, row in enumerate(itertools.product([False, True], repeat=3))
    ]
    for text, expected in [
        ("$A AND ($B OR NOT $C)", lambda a, b, c: a and (b or not c)),
        ("$A OR $B AND NOT $C", lambda a, b, c: a or b and not c),
        ("not ($a or $b) and not not $c", lambda a, b, c: not (a or b) and c),
    ]:
        wanted = [
            str(i) for i, row in enumerate(itertools.product([False, True], repeat=3)) if expected(*row)
        ]
        assert select(blocks, Selector(**expression(text))) == wanted


@pytest.mark.parametrize(
    "text",
    [
        "",
        "$A AND",
        "A OR B",
        "$A $B",
        "$A || $B",
        "($A",
        "$A)",
        "__import__('os')",
        "NOT " * 34 + "$A",
        "(" * 34 + "$A" + ")" * 34,
    ],
)
def test_invalid_expressions_never_fall_back_to_all(text):
    with pytest.raises(ValueError):
        parse_expression(text)


def test_deleted_duplicate_and_unknown_condition_references_rejected():
    selector = expression("$A AND NOT $B")
    selector["conditions"] = [c for c in selector["conditions"] if c["key"] != "B"]
    with pytest.raises(ValidationError, match=r"\$B"):
        Selector(**selector)
    with pytest.raises(ValidationError, match="代号不能重复"):
        Selector(**expression("$A", [{"key": "A", "field": "tag", "value": "a"}] * 2))


def test_range_and_not_respect_read_only_objects():
    blocks = [{"id": "p1"}, {"id": "p2"}, {"id": "p3", "editable": False}]
    assert select(blocks, Selector(**scope("p1", "p3"))) == ["p1"]
    selector = expression("NOT $A", [{"key": "A", "field": "ids", "ids": ["p1"]}])
    assert select(blocks, Selector(**selector)) == ["p2"]
    with pytest.raises(ValidationError):
        Selector(**scope())


def test_single_object_format_only_changes_one_paragraph_and_keeps_zip_parts(client):
    doc = client.post("/api/projects/demo").json()
    base = f"/api/projects/{doc['id']}"
    source = client.app.state.store.source(doc["id"])
    request = {"revision": doc["revision"], "selector": scope("p3"), "patch": {"size_pt": 18}}
    assert client.post(base + "/preview", json=request).json()["ids"] == ["p3"]
    assert client.post(base + "/apply", json=request).status_code == 200
    exported = client.get(base + "/export/docx").content
    before, after = DocxPackage(source), DocxPackage(exported)
    for identity in before.by_id:
        equal = etree.tostring(before.by_id[identity]) == etree.tostring(after.by_id[identity])
        assert equal == (identity != "p3")
    for name in before.archive.namelist():
        if name != "word/document.xml":
            assert before.archive.read(name) == after.archive.read(name)
    assert client.app.state.store.source(doc["id"]) == source


def test_saved_selector_history_conflicts_and_project_roundtrip(client, tmp_path):
    doc = client.post("/api/projects/demo").json()
    base = f"/api/projects/{doc['id']}"
    original_word = client.get(base + "/export/docx").content
    selector = expression(
        "$A AND NOT $B",
        [
            {"key": "A", "field": "role", "value": "body"},
            {"key": "B", "field": "ids", "ids": ["p7"]},
        ],
    )
    saved = client.post(
        base + "/selections/save",
        json={"revision": doc["revision"], "name": " 我的正文 ", "selector": selector},
    ).json()
    item = saved["saved_selectors"][0]
    assert item["name"] == "我的正文"
    assert saved["blocks"] == doc["blocks"]
    assert client.get(base + "/export/docx").content == original_word
    stale = {"revision": doc["revision"], "selector": selector, "patch": {"size_pt": 18}}
    assert client.post(base + "/apply", json=stale).status_code == 409
    assert (
        client.post(
            base + "/selections/save",
            json={"revision": saved["revision"], "name": "我的正文", "selector": selector},
        ).status_code
        == 400
    )
    deleted = client.post(
        base + "/selections/delete", json={"revision": saved["revision"], "id": item["id"]}
    ).json()
    assert deleted["saved_selectors"] == []
    restored = client.post(base + "/undo", json={"revision": deleted["revision"]}).json()
    assert restored["saved_selectors"] == [item]
    bundle = client.get(base + "/export/project").content
    store = ProjectStore(tmp_path / "fresh-install")
    reopened = store.import_file(bundle, "portable.sdoc")
    assert store.view(reopened)["saved_selectors"] == [item]
    assert store.view(reopened)["blocks"] == doc["blocks"]
    store.history(reopened, reopened.revision, "redo")
    assert reopened.saved_selectors == []
    repeated = client.post("/api/projects/import", files={"file": ("again.sdoc", bundle)}).json()
    assert repeated["id"] == doc["id"]


def test_old_project_migration_preserves_annotations_and_history(client):
    doc = client.post("/api/projects/demo").json()
    original_blocks = doc["blocks"]
    base = f"/api/projects/{doc['id']}"
    doc = client.post(
        base + "/annotate", json={"revision": doc["revision"], "ids": ["p3"], "tags": ["已有标注"]}
    ).json()
    path = client.app.state.store.folder(doc["id"]) / "project.json"
    legacy = json.loads(path.read_bytes())
    legacy["version"] = 1
    legacy.pop("saved_selectors")
    for snapshot in legacy["undo"] + legacy["redo"]:
        snapshot.pop("saved_selectors")
    raw = json.dumps(legacy, ensure_ascii=False).encode()
    path.write_bytes(raw)
    reloaded = client.get(base).json()
    assert reloaded["blocks"] == doc["blocks"]
    assert reloaded["saved_selectors"] == []
    assert json.loads(path.read_bytes())["version"] == 5
    assert reloaded["revision"] == doc["revision"] + 1
    saved = client.post(
        base + "/selections/save",
        json={"revision": reloaded["revision"], "name": "单段", "selector": scope("p3")},
    ).json()
    assert json.loads(path.read_bytes())["version"] == 5
    undone = client.post(base + "/undo", json={"revision": saved["revision"]}).json()
    assert undone["blocks"] == doc["blocks"] and undone["saved_selectors"] == []
    old_undo = client.post(base + "/undo", json={"revision": undone["revision"]}).json()
    assert old_undo["blocks"] == original_blocks


def test_different_saved_collections_are_not_deduplicated(client):
    doc = client.post("/api/projects/demo").json()
    base = f"/api/projects/{doc['id']}"
    original = client.get(base + "/export/project").content
    output = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(original)) as source, zipfile.ZipFile(output, "w") as target:
        state = json.loads(source.read("project.json"))
        state["saved_selectors"] = [{"id": "a" * 32, "name": "另一个范围", "selector": scope("p3")}]
        target.writestr("project.json", json.dumps(state))
        target.writestr("source.docx", source.read("source.docx"))
    imported = client.post(
        "/api/projects/import", files={"file": ("different.sdoc", output.getvalue())}
    ).json()
    assert imported["id"] != doc["id"]
    assert len(imported["saved_selectors"]) == 1


def test_reset_role_restores_auto_without_changing_tags_or_format(client):
    doc = client.post("/api/projects/demo").json()
    base = f"/api/projects/{doc['id']}"
    changed = client.post(
        base + "/annotate",
        json={"revision": doc["revision"], "ids": ["p3"], "role": "quote", "tags": ["保留"]},
    ).json()
    formatted = client.post(
        base + "/apply",
        json={"revision": changed["revision"], "selector": scope("p3"), "patch": {"size_pt": 18}},
    ).json()
    reset = client.post(
        base + "/annotate", json={"revision": formatted["revision"], "ids": ["p3"], "reset_role": True}
    ).json()
    block = next(b for b in reset["blocks"] if b["id"] == "p3")
    assert block["role"] == "body" and not block["confirmed"]
    assert block["tags"] == ["保留"] and block["overrides"] == {"size_pt": 18}
    undone = client.post(base + "/undo", json={"revision": reset["revision"]}).json()
    assert next(b for b in undone["blocks"] if b["id"] == "p3")["role"] == "quote"


def test_invalid_expression_cannot_be_saved_previewed_or_applied(client):
    doc = client.post("/api/projects/demo").json()
    base = f"/api/projects/{doc['id']}"
    selector = expression("$A OR $MISSING")
    assert client.post(base + "/select", json=selector).status_code == 422
    for operation in ("preview", "apply"):
        assert (
            client.post(
                base + "/" + operation,
                json={"revision": doc["revision"], "selector": selector, "patch": {"size_pt": 18}},
            ).status_code
            == 422
        )
    assert (
        client.post(
            base + "/selections/save",
            json={"revision": doc["revision"], "name": "无效", "selector": selector},
        ).status_code
        == 422
    )
    assert client.get(base).json()["revision"] == doc["revision"]


def test_saved_selector_rejects_uneditable_nested_json_but_query_keeps_support(client):
    doc = client.post("/api/projects/demo").json()
    base = f"/api/projects/{doc['id']}"
    nested = {"conditions": [scope("p3")]}
    assert client.post(base + "/select", json=nested).json()["ids"] == ["p3"]
    response = client.post(
        base + "/selections/save", json={"revision": doc["revision"], "name": "nested", "selector": nested}
    )
    assert response.status_code == 400
    assert "高级表达式" in response.json()["detail"]
    assert client.get(base).json()["saved_selectors"] == []
