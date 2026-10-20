import io
import json
import zipfile

import pytest
from lxml import etree
from structured_editor.docx.package import DocxPackage
from structured_editor.docx.xml import NS, q, value
from structured_editor.storage import ProjectStore


def scope(*ids):
    return {"conditions": [{"field": "ids", "ids": list(ids)}]}


def rule(name="正文规则", key="a", selector=None, patch=None, enabled=True):
    return {
        "id": key * 32,
        "name": name,
        "selector": selector or scope("p3"),
        "patch": patch or {"size_pt": 16, "first_line_chars": 2},
        "enabled": enabled,
    }


def post(client, doc, route, **body):
    result = client.post(f"/api/projects/{doc['id']}/{route}", json={"revision": doc["revision"], **body})
    assert result.status_code == 200, result.text
    return result.json()


def block(doc, identity="p3"):
    return next(b for b in doc["blocks"] if b["id"] == identity)


def save(client, doc, item):
    return post(client, doc, "rules/apply", action="save", rule=item)


def test_rule_precedence_order_and_local_override_clear(client):
    doc = client.post("/api/projects/demo").json()
    first = rule()
    second = rule("字号例外", "b", patch={"size_pt": 20})
    doc = save(client, save(client, doc, first), second)
    assert block(doc)["format"]["size_pt"] == 20
    assert block(doc)["format"]["first_line_chars"] == 2
    assert [r["effective_count"] for r in doc["rules"]] == [1, 1]
    doc = post(client, doc, "apply", selector=scope("p3"), patch={"size_pt": 24})
    layers = block(doc)["format_trace"]["size_pt"]
    assert [layer["kind"] for layer in layers] == ["source", "rule", "rule", "local"]
    assert [layer["value"] for layer in layers[1:]] == [16, 20, 24]
    assert doc["rules"][1]["effective_count"] == 0
    doc = post(client, doc, "overrides/clear", ids=["p3"], keys=["size_pt"])
    assert block(doc)["format"]["size_pt"] == 20 and block(doc)["overrides"] == {}
    doc = post(client, doc, "rules/apply", action="move", id=first["id"], position=1)
    assert block(doc)["format"]["size_pt"] == 16
    assert [r["effective_count"] for r in doc["rules"]] == [0, 1]
    doc = post(client, doc, "rules/apply", action="toggle", id=first["id"], enabled=False)
    assert block(doc)["format"]["size_pt"] == 20
    assert doc["rules"][1]["matched_count"] == 1 and doc["rules"][1]["effective_count"] == 0


def test_rule_semantic_rematching_after_atomic_bulk_annotations(client):
    original = client.post("/api/projects/demo").json()
    selector = {
        "conditions": [{"field": "role", "value": "body"}, {"field": "tag", "op": "is_not", "value": "例外"}]
    }
    doc = save(client, original, rule(selector=selector))
    selected = client.post(f"/api/projects/{doc['id']}/select", json=selector).json()["ids"]
    doc = post(client, doc, "annotations/bulk", selector=selector, action="add_tag", tag="例外")
    assert [b["id"] for b in doc["blocks"] if "例外" in b["tags"]] == selected
    assert doc["rules"][0]["matched_count"] == 0
    assert block(doc)["format"] == block(original)["format"]
    doc = post(
        client,
        doc,
        "annotations/bulk",
        selector={"conditions": [{"field": "tag", "value": "例外"}]},
        action="remove_tag",
        tag="例外",
    )
    assert doc["rules"][0]["matched_count"] == len(selected)
    doc = post(client, doc, "annotations/bulk", selector=scope("p3"), action="set_role", role="heading")
    assert block(doc)["role"] == "heading" and block(doc)["format"] == block(original)["format"]
    doc = post(client, doc, "annotations/bulk", selector=scope("p3"), action="reset_role")
    assert block(doc)["role"] == "body" and block(doc)["format"]["size_pt"] == 16
    assert block(doc)["overrides"] == {}


def test_preview_is_read_only_and_restores_mixed_runs(client, source):
    package = DocxPackage(source)
    paragraph = package.by_id["p3"]
    run = etree.SubElement(paragraph, q("r"))
    props = etree.SubElement(run, q("rPr"))
    etree.SubElement(props, q("sz"), {q("val"): "48"})
    etree.SubElement(run, q("t")).text = "混合字号"
    doc = client.post(
        "/api/projects/import", files={"file": ("mixed.docx", package.replace_document())}
    ).json()
    original = block(doc)
    assert "size_pt" in original["mixed"]
    item = rule(patch={"size_pt": 18})
    preview = post(client, doc, "rules/preview", action="save", rule=item)
    assert preview["ids"] == ["p3"]
    assert all(r["format"]["size_pt"] == 18 for r in preview["after_blocks"][0]["runs"])
    assert client.get(f"/api/projects/{doc['id']}").json() == doc
    doc = save(client, doc, item)
    edited = {**item, "patch": {"alignment": "center"}}
    restored = post(client, doc, "rules/preview", action="save", rule=edited)["after_blocks"][0]
    assert restored["runs"] == original["runs"]
    assert restored["mixed"] == original["mixed"]
    assert client.get(f"/api/projects/{doc['id']}").json() == doc
    stale = client.post(
        f"/api/projects/{doc['id']}/rules/apply",
        json={"revision": preview["revision"], "action": "save", "rule": edited},
    )
    assert stale.status_code == 409


def test_export_rules_retains_unselected_paragraphs_and_all_other_parts(client, rich_source):
    doc = client.post("/api/projects/import", files={"file": ("rich.docx", rich_source)}).json()
    item = rule(patch={"size_pt": 18, "first_line_chars": 2, "line_spacing": 1.5})
    doc = save(client, doc, item)
    fmt = block(doc)["format"]
    assert "line_spacing_pt" not in fmt and "first_line_pt" not in fmt
    path = f"/api/projects/{doc['id']}/export/docx"
    output = client.get(path).content
    old, new = DocxPackage(rich_source), DocxPackage(output)
    for identity in old.by_id:
        if identity != "p3":
            assert etree.tostring(old.by_id[identity]) == etree.tostring(new.by_id[identity])
    for name in old.archive.namelist():
        if name != "word/document.xml":
            assert old.archive.read(name) == new.archive.read(name)
    assert old.document.xpath("//w:t/text()", namespaces=NS) == new.document.xpath(
        "//w:t/text()", namespaces=NS
    )
    assert value(new.by_id["p3"], "w:pPr/w:ind", "firstLineChars") == "200"
    assert value(new.by_id["p3"], "w:pPr/w:spacing", "line") == "360"
    doc = post(client, doc, "rules/apply", action="delete", id=item["id"])
    assert client.get(path).content == rich_source
    assert client.app.state.store.source(doc["id"]) == rich_source


def test_history_restores_rules_annotations_and_saved_selections(client):
    original = client.post("/api/projects/demo").json()
    doc = save(client, original, rule())
    doc = post(client, doc, "selections/save", name="单段", selector=scope("p3"))
    saved = doc
    doc = post(client, doc, "annotations/bulk", selector=scope("p3"), action="add_tag", tag="新标签")
    doc = post(client, doc, "undo")
    assert doc["blocks"] == saved["blocks"] and doc["rules"] == saved["rules"]
    assert doc["saved_selectors"] == saved["saved_selectors"]
    doc = post(client, doc, "undo")
    assert doc["rules"] and not doc["saved_selectors"]
    doc = post(client, doc, "undo")
    assert doc["blocks"] == original["blocks"] and not doc["rules"]
    doc = post(client, doc, "redo")
    assert doc["rules"] == saved["rules"]


@pytest.mark.parametrize("version", [1, 2])
def test_legacy_rules_migration_is_lazy_and_keeps_history(client, version):
    doc = client.post("/api/projects/demo").json()
    doc = post(client, doc, "annotate", ids=["p3"], tags=["旧标签"])
    path = client.app.state.store.folder(doc["id"]) / "project.json"
    legacy = json.loads(path.read_bytes())
    legacy["version"] = version
    for state in [legacy, *legacy["undo"], *legacy["redo"]]:
        state.pop("rules")
        if version == 1:
            state.pop("saved_selectors")
    data = json.dumps(legacy).encode()
    path.write_bytes(data)
    reloaded = client.get(f"/api/projects/{doc['id']}").json()
    assert reloaded["blocks"] == doc["blocks"] and reloaded["rules"] == []
    assert path.read_bytes() == data
    doc = save(client, reloaded, rule())
    assert json.loads(path.read_bytes())["version"] == 4
    doc = post(client, doc, "undo")
    assert block(doc)["tags"] == ["旧标签"] and not doc["rules"]
    doc = post(client, doc, "undo")
    assert block(doc)["tags"] != ["旧标签"]


def test_portable_rules_and_history_survive_and_dedup_includes_rules(client, tmp_path):
    doc = save(client, client.post("/api/projects/demo").json(), rule())
    base = f"/api/projects/{doc['id']}"
    bundle = client.get(base + "/export/project").content
    store = ProjectStore(tmp_path / "other")
    imported = store.import_file(bundle, "portable.sdoc")
    assert store.view(imported)["blocks"] == doc["blocks"]
    assert store.view(imported)["rules"] == doc["rules"]
    store.history(imported, imported.revision, "undo")
    assert imported.rules == []
    assert (
        client.post("/api/projects/import", files={"file": ("same.sdoc", bundle)}).json()["id"] == doc["id"]
    )
    output = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(bundle)) as old, zipfile.ZipFile(output, "w") as new:
        state = json.loads(old.read("project.json"))
        state["rules"][0]["name"] = "另一版本"
        new.writestr("project.json", json.dumps(state))
        new.writestr("source.docx", old.read("source.docx"))
    different = client.post("/api/projects/import", files={"file": ("other.sdoc", output.getvalue())}).json()
    assert different["id"] != doc["id"]


def test_bulk_tag_overflow_is_atomic_and_preserves_other_fields(client):
    doc = client.post("/api/projects/demo").json()
    doc = post(client, doc, "annotate", ids=["p5"], tags=[f"tag{i}" for i in range(30)], role="quote")
    doc = post(client, doc, "apply", selector=scope("p3"), patch={"size_pt": 19})
    failed = client.post(
        f"/api/projects/{doc['id']}/annotations/bulk",
        json={
            "revision": doc["revision"],
            "selector": scope("p3", "p5"),
            "action": "add_tag",
            "tag": "overflow",
        },
    )
    assert failed.status_code == 400
    assert client.get(f"/api/projects/{doc['id']}").json() == doc
    updated = post(client, doc, "annotations/bulk", selector=scope("p3", "p5"), action="add_tag", tag="tag0")
    assert block(updated)["overrides"] == {"size_pt": 19}
    assert block(updated, "p5")["role"] == "quote"
    assert block(updated, "p5")["tags"] == block(doc, "p5")["tags"]
    repeated = post(
        client, updated, "annotations/bulk", selector=scope("p3", "p5"), action="add_tag", tag="tag0"
    )
    assert repeated["revision"] == updated["revision"]


def test_rules_and_bulk_operations_exclude_read_only_blocks(client, source):
    package = DocxPackage(source)
    paragraph = package.by_id["p3"]
    etree.SubElement(paragraph, q("ins"))
    data = package.replace_document()
    doc = client.post("/api/projects/import", files={"file": ("readonly.docx", data)}).json()
    original = block(doc)
    item = rule(selector=scope("p3", "p5"))
    doc = save(client, doc, item)
    assert doc["rules"][0]["matched_count"] == 1
    doc = post(
        client, doc, "annotations/bulk", selector=scope("p3", "p5"), action="add_tag", tag="只改可编辑"
    )
    assert block(doc) == original
    output = client.get(f"/api/projects/{doc['id']}/export/docx").content
    assert etree.tostring(DocxPackage(output).by_id["p3"]) == etree.tostring(paragraph)
    assert (
        client.post(
            f"/api/projects/{doc['id']}/overrides/clear",
            json={"revision": doc["revision"], "ids": ["p3"], "keys": ["size_pt"]},
        ).status_code
        == 400
    )


@pytest.mark.parametrize(
    "action",
    [
        {"action": "save", "rule": {**rule(), "patch": {}}},
        {
            "action": "save",
            "rule": {
                **rule(),
                "selector": {"mode": "expression", "expression": "$MISSING", "conditions": []},
            },
        },
        {"action": "toggle", "id": "a" * 32},
        {"action": "delete", "id": "a" * 32, "enabled": True},
        {"action": "move", "id": "a" * 32, "position": -1},
    ],
)
def test_invalid_rule_actions_rejected_without_mutation(client, action):
    doc = client.post("/api/projects/demo").json()
    response = client.post(
        f"/api/projects/{doc['id']}/rules/apply", json={"revision": doc["revision"], **action}
    )
    assert response.status_code == 422
    assert client.get(f"/api/projects/{doc['id']}").json() == doc


def test_zero_match_disabled_and_fully_overridden_rules_can_be_saved(client):
    doc = client.post("/api/projects/demo").json()
    zero = rule(selector={"conditions": [{"field": "tag", "value": "将来的标签"}]})
    preview = post(client, doc, "rules/preview", action="save", rule=zero)
    assert preview["ids"] == [] and preview["rules"][0]["matched_count"] == 0
    doc = save(client, doc, zero)
    disabled = rule("已停用", "b", enabled=False)
    doc = save(client, doc, disabled)
    assert doc["rules"][1]["matched_count"] == 1 and doc["rules"][1]["effective_count"] == 0
    doc = post(client, doc, "apply", selector=scope("p3"), patch={"size_pt": 19, "first_line_chars": 0})
    preview = post(client, doc, "rules/preview", action="toggle", id=disabled["id"], enabled=True)
    assert not preview["ids"] and preview["rules"][1]["effective_count"] == 0
    duplicate = client.post(
        f"/api/projects/{doc['id']}/rules/apply",
        json={"revision": doc["revision"], "action": "save", "rule": {**disabled, "id": "c" * 32}},
    )
    assert duplicate.status_code == 400
