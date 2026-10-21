import io
import json
import zipfile
from copy import deepcopy

import pytest
from lxml import etree
from structured_editor.docx.package import DocxPackage
from structured_editor.domain.migrations import freeze_rules
from structured_editor.domain.models import Annotation, FormatPatch, FormatRule, Selector, Snapshot
from structured_editor.domain.rules import resolve
from structured_editor.domain.templates import extract_template
from structured_editor.storage import ProjectStore


def template(patch=None, role="body", name="报告"):
    return {"version": 1, "name": name, "entries": [{"role": role, "patch": patch or {"size_pt": 16, "first_line_chars": 2}}]}


def post(client, doc, action, **values):
    response = client.post(f"/api/projects/{doc['id']}/{action}", json={"revision": doc["revision"], **values})
    assert response.status_code == 200, response.text
    return response.json()


def synthetic(identity, fmt, role="body", runs=None, editable=True):
    return {"id": identity, "format": fmt, "runs": runs or [], "role": role, "editable": editable}


def test_extract_counts_real_combinations_not_per_property_majorities():
    blocks = [synthetic("p1", {"size_pt": 12, "alignment": "left"}),
              synthetic("p2", {"size_pt": 12, "alignment": "left"}),
              synthetic("p3", {"size_pt": 14, "alignment": "right"}),
              synthetic("p4", {"size_pt": 14, "alignment": "center"}),
              synthetic("p5", {"size_pt": 14, "alignment": "both"})]
    group = extract_template(blocks)[0]
    assert group["suggested"] == 0 and not group["tied"]
    assert group["candidates"][0]["patch"] == {"size_pt": 12, "alignment": "left"}
    assert group["candidates"][0]["count"] == 2 and group["count"] == 5
    tie = extract_template(blocks[:1] + blocks[2:3])[0]
    assert tie["suggested"] is None and tie["tied"]


def test_extract_omits_mixed_unknown_unsupported_without_inventing_defaults():
    blocks = [synthetic("p1", {"size_pt": 20, "first_line_pt": -10, "line_spacing_pt": 15,
                               "space_before_pt": 0, "italic": False, "line_spacing": 1.333},
                        runs=[{"format": {"size_pt": 12, "italic": False}},
                              {"format": {"size_pt": 20, "italic": False}}]),
              synthetic("p2", {"size_pt": 99}, editable=False)]
    candidate = extract_template(blocks)[0]["candidates"][0]
    assert candidate["patch"] == {"space_before_pt": 0, "italic": False}
    assert candidate["omitted"]["size_pt"] == 1
    assert "line_spacing" in candidate["omitted"] and "first_line_chars" in candidate["omitted"]
    assert extract_template([synthetic("p1", {})])[0]["suggested"] is None


def test_template_library_global_revision_portable_delete_restore(client):
    lib = client.get("/api/templates").json()
    assert lib["items"] == []
    first = client.post("/api/templates/save", json={"revision": 0, "template": template()})
    assert first.status_code == 200, first.text
    lib = first.json()
    item = lib["items"][0]
    assert item["entries"][0]["patch"] == template()["entries"][0]["patch"]
    assert client.get("/api/templates").json() == lib
    assert client.post("/api/templates/save", json={"revision": 0, "template": template(name="另存")}).status_code == 409
    assert client.post("/api/templates/save", json={"revision": lib["revision"], "template": template()}).status_code == 400
    portable = client.get(f"/api/templates/{item['id']}/export")
    assert portable.status_code == 200 and portable.json() == template()
    assert "ids" not in portable.json() and "id" not in portable.json()
    deleted = client.post("/api/templates/delete", json={"revision": lib["revision"], "id": item["id"]}).json()
    assert not deleted["items"] and deleted["deleted"] == [item]
    restored = client.post("/api/templates/restore", json={"revision": deleted["revision"], "id": item["id"]}).json()
    assert restored["items"] == [item] and restored["deleted"] == []
    imported = template(name="另一机器的模板")
    response = client.post(f"/api/templates/import?revision={restored['revision']}", files={"file": ("test.json", json.dumps(imported).encode())})
    assert response.status_code == 200 and len(response.json()["items"]) == 2
    bad = deepcopy(imported)
    bad["entries"][0]["ids"] = ["p3"]
    assert client.post(f"/api/templates/import?revision={response.json()['revision']}", files={"file": ("test.json", json.dumps(bad).encode())}).status_code == 400


def test_preview_one_shot_scope_export_history_and_portable_result(client, rich_source, tmp_path):
    doc = client.post("/api/projects/import", files={"file": ("source.docx", rich_source)}).json()
    scope = {"conditions": [{"field": "ids", "ids": ["p3", "p1"]}]}
    original = deepcopy(doc)
    preview = post(client, doc, "templates/preview", template=template(), selector=scope)
    assert preview["ids"] == ["p3"]  # P1 title is inside scope but absent in template.
    assert client.get(f"/api/projects/{doc['id']}").json() == doc
    doc = post(client, doc, "templates/apply", template=template(), selector=scope)
    assert not doc["rules"] and doc["undo_label"].startswith("应用模板")
    assert client.post(f"/api/projects/{doc['id']}/templates/apply", json={"revision": original["revision"], "template": template()}).status_code == 409
    output = client.get(f"/api/projects/{doc['id']}/export/docx").content
    before, after = DocxPackage(rich_source), DocxPackage(output)
    for identity in before.by_id:
        if identity != "p3":
            assert etree.tostring(before.by_id[identity]) == etree.tostring(after.by_id[identity])
    with zipfile.ZipFile(io.BytesIO(rich_source)) as old, zipfile.ZipFile(io.BytesIO(output)) as new:
        for name in old.namelist():
            if name != "word/document.xml":
                assert old.read(name) == new.read(name)
    changed = post(client, doc, "annotate", ids=["p3"], role="heading")
    p3 = next(b for b in changed["blocks"] if b["id"] == "p3")
    assert p3["format"]["size_pt"] == 16  # No automatic category rematching.
    undone = post(client, post(client, changed, "undo"), "undo")
    assert undone["blocks"] == original["blocks"]
    restored = post(client, undone, "redo")
    bundle = client.get(f"/api/projects/{doc['id']}/export/project").content
    other = ProjectStore(tmp_path / "other")
    imported = other.import_file(bundle, "copy.sdoc")
    assert other.view(imported)["blocks"] == restored["blocks"]
    assert not (other.root / "templates.json").exists()


def test_same_template_applies_to_different_document_categories(client):
    one = client.post("/api/projects/demo").json()
    two = client.post("/api/projects/demo").json()
    two = post(client, two, "annotate", ids=["p3"], role="heading")
    for doc in (one, two):
        preview = post(client, doc, "templates/preview", template=template({"bold": False}, "heading"))
        assert preview["ids"] == [b["id"] for b in doc["blocks"] if b["role"] == "heading" and b["editable"]]
    empty = post(client, one, "templates/preview", template=template(), selector={"mode": "any", "conditions": []})
    assert empty["ids"] == []


def visual(view):
    return [{key: b.get(key) for key in ("id", "format", "runs", "mixed", "role", "tags", "paragraph_size_pt")} for b in view["blocks"]]


def test_migration_freezes_every_history_state_and_keeps_archive(client):
    from structured_editor.domain.models import SizeOverrides
    doc = client.post("/api/projects/demo").json()
    store = client.app.state.store
    project = store.load(doc["id"])
    original = store.original_view(project.id)
    rule = FormatRule(id="a" * 32, name="正文", selector=Selector(conditions=[{"field": "role", "value": "body"}]), patch=FormatPatch(size_pt=20, italic=True))
    project.rules = [rule]
    project.annotations["p3"] = Annotation(format=FormatPatch(size_pt=25), sizes=SizeOverrides(paragraph_pt=24, runs={"0": 23}), tags=["保留"])
    project.undo = [Snapshot(label="旧标签", annotations={"p3": Annotation(role="heading")}, rules=[rule])]
    project.redo = [Snapshot(label="旧禁用", annotations={}, rules=[rule.model_copy(update={"enabled": False})])]
    project.version = 4
    before = visual(resolve(original, project))
    history = [visual(resolve(original, project.model_copy(update={"rules": s.rules, "annotations": s.annotations}))) for s in project.undo + project.redo]
    upgraded = freeze_rules(original, project)
    assert upgraded.version == 5 and upgraded.revision == project.revision + 1
    assert visual(resolve(original, upgraded)) == before and not upgraded.rules
    assert upgraded.legacy_rule_archive.current.rules == [rule]
    assert project.rules == [rule] and project.version == 4  # Caller remains untouched until atomic save.
    for index, state in enumerate(upgraded.undo + upgraded.redo):
        assert not state.rules
        assert visual(resolve(original, upgraded.model_copy(update={"annotations": state.annotations}))) == history[index]
    assert freeze_rules(original, upgraded) is upgraded
    store.save(project)
    output = store.word_export(project)[0]
    migrated = client.get(f"/api/projects/{project.id}").json()
    assert migrated["legacy_migration"]["archived"]
    assert store.word_export(store.load(project.id))[0] == output
    reopened = client.get(f"/api/projects/{project.id}").json()
    assert reopened == migrated
    assert client.post(f"/api/projects/{project.id}/rules/apply", json={"revision": migrated["revision"], "action": "save", "rule": rule.model_dump()}).status_code == 400
    bundle = store.export_project(store.load(project.id))
    with zipfile.ZipFile(io.BytesIO(bundle)) as archive:
        assert json.loads(archive.read("project.json"))["legacy_rule_archive"]["current"]["rules"]


def test_migration_failure_does_not_write_partial_result(client, monkeypatch):
    doc = client.post("/api/projects/demo").json()
    store = client.app.state.store
    project = store.load(doc["id"])
    project.rules = [FormatRule(id="b" * 32, name="迁移测试", selector=Selector(), patch=FormatPatch(size_pt=14))]
    store.save(project)
    path = store.folder(project.id) / "project.json"
    raw = path.read_bytes()
    def fail(*args):
        raise ValueError("模拟迁移计算失败")
    monkeypatch.setattr("structured_editor.domain.migrations.resolve", fail)
    with pytest.raises(ValueError):
        store.upgrade(project)
    assert path.read_bytes() == raw


def test_rule_free_v4_project_upgrades_once_without_changing_history_or_source(client):
    doc = client.post("/api/projects/demo").json()
    doc = post(client, doc, "apply", selector={"conditions": [{"field": "ids", "ids": ["p3"]}]}, patch={"italic": True})
    store = client.app.state.store
    project = store.load(doc["id"])
    project.version = 4
    store.save(project)
    source = store.source(project.id)
    changed = client.get(f"/api/projects/{project.id}").json()
    upgraded = store.load(project.id)
    assert upgraded.version == 5 and upgraded.revision == project.revision + 1
    assert upgraded.annotations == project.annotations and upgraded.undo == project.undo
    assert changed["blocks"] == doc["blocks"] and changed["legacy_migration"] is None
    assert store.source(project.id) == source
    raw = (store.folder(project.id) / "project.json").read_bytes()
    assert client.get(f"/api/projects/{project.id}").json() == changed
    assert (store.folder(project.id) / "project.json").read_bytes() == raw


def test_migration_history_only_rules_missing_scope_and_priority(client):
    doc = client.post("/api/projects/demo").json()
    store = client.app.state.store
    project = store.load(doc["id"])
    original = store.original_view(project.id)
    first = FormatRule(id="c" * 32, name="前层", selector=Selector(), patch=FormatPatch(size_pt=18, bold=True))
    second = FormatRule(id="d" * 32, name="后层", selector=Selector(), patch=FormatPatch(size_pt=20))
    missing = FormatRule(id="e" * 32, name="失效章节", selector=Selector(conditions=[{"field": "chapter", "op": "is_not", "value": "p999"}]), patch=FormatPatch(italic=True))
    project.undo = [Snapshot(label="历史规则", annotations={"p3": Annotation(format=FormatPatch(size_pt=22))}, rules=[first, second, missing])]
    expected = visual(resolve(original, project.model_copy(update={"annotations": project.undo[0].annotations, "rules": project.undo[0].rules})))
    upgraded = freeze_rules(original, project)
    assert not upgraded.rules and not upgraded.undo[0].rules
    assert visual(resolve(original, upgraded)) == visual(resolve(original, project))
    assert upgraded.legacy_rule_archive.warnings and "失效章节" in upgraded.legacy_rule_archive.warnings[0]
    store.save(upgraded)
    store.history(upgraded, upgraded.revision, "undo")
    assert visual(store.view(upgraded)) == expected
    assert all(b["format"]["size_pt"] == (22 if b["id"] == "p3" else 20) for b in store.view(upgraded)["blocks"] if b["editable"])
    store.history(upgraded, upgraded.revision, "redo")
    assert visual(store.view(upgraded)) == visual(resolve(original, project))


def test_failed_legacy_bundle_migration_creates_no_project(tmp_path, monkeypatch):
    store = ProjectStore(tmp_path / "source")
    project = store.demo()
    project.rules = [FormatRule(id="f" * 32, name="旧规则", selector=Selector(), patch=FormatPatch(bold=True))]
    bundle = store.export_project(project)
    destination = ProjectStore(tmp_path / "destination")
    def fail(*args):
        raise ValueError("模拟迁移计算失败")
    monkeypatch.setattr("structured_editor.domain.migrations.resolve", fail)
    with pytest.raises(ValueError):
        destination.import_file(bundle, "old.sdoc")
    assert list(destination.root.iterdir()) == []


def test_template_preserves_mixed_text_unless_explicitly_set_and_clears_size_override(client, rich_source):
    doc = client.post("/api/projects/import", files={"file": ("mixed.docx", rich_source)}).json()
    scope = {"conditions": [{"field": "ids", "ids": ["p3"]}]}
    paragraph = next(b for b in doc["blocks"] if b["id"] == "p3")
    assert "bold" in paragraph["mixed"]
    doc = post(client, doc, "templates/apply", selector=scope, template=template({"first_line_chars": 0}))
    assert next(b for b in doc["blocks"] if b["id"] == "p3")["runs"] == paragraph["runs"]
    preview = post(client, doc, "templates/preview", selector=scope, template=template({"bold": False}))
    assert any("粗体" in warning for warning in preview["warnings"])
    doc = post(client, doc, "apply", selector=scope, patch={}, size_change={"mode": "points", "amount": 1})
    store = client.app.state.store
    previous_sizes = store.load(doc["id"]).annotations["p3"].sizes
    assert previous_sizes is not None
    doc = post(client, doc, "templates/apply", selector=scope, template=template({"first_line_chars": 0, "bold": False}))
    assert all(run["format"]["bold"] is False for run in next(b for b in doc["blocks"] if b["id"] == "p3")["runs"])
    assert store.load(doc["id"]).annotations["p3"].sizes == previous_sizes
    doc = post(client, doc, "templates/apply", selector=scope, template=template({"size_pt": 18}))
    assert store.load(doc["id"]).annotations["p3"].sizes is None
    assert next(b for b in doc["blocks"] if b["id"] == "p3")["format"]["size_pt"] == 18
