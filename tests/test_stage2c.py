import io
import json
import zipfile

import pytest
from compatibility_samples import compatibility_source, replace_parts
from lxml import etree
from structured_editor.docx.audit import audit_export
from structured_editor.docx.package import DocxPackage
from structured_editor.docx.reader import project_document
from structured_editor.docx.xml import q, value
from structured_editor.domain.models import SizeChange
from structured_editor.domain.sizes import shifted_size
from structured_editor.storage import ProjectStore


def scope(*ids):
    return {"conditions": [{"field": "ids", "ids": list(ids)}]}


def block(doc, identity="p3"):
    return next(b for b in doc["blocks"] if b["id"] == identity)


def post(client, doc, route, **body):
    response = client.post(f"/api/projects/{doc['id']}/{route}", json={"revision": doc["revision"], **body})
    assert response.status_code == 200, response.text
    return response.json()


@pytest.fixture
def document(client, source):
    return client.post(
        "/api/projects/import", files={"file": ("compatibility.docx", compatibility_source(source))}
    ).json()


def test_theme_numbering_and_toggle_inheritance(document):
    fmt = block(document)["format"]
    assert fmt["font_east_asia"] == "主题宋体" and fmt["font_latin"] == "Theme Latin"
    assert "主题" in block(document)["format_sources"]["font_east_asia"]
    assert block(document, "p5")["format"]["bold"] is False
    numbered = block(document, "p9")
    assert numbered["numbering"] == {
        "num_id": "7",
        "level": 0,
        "format": "decimal",
        "text": "%1.",
        "start": "4",
        "resolved": True,
    }
    assert numbered["format"]["left_indent_pt"] == 36 and numbered["format"]["first_line_pt"] == -18
    assert numbered["format"]["size_pt"] == 12, "编号字形 40 磅不能污染正文"
    assert fmt["widow_control"] is True


def test_relative_sizes_preserve_mixed_runs_export_history_and_clear(client, document, tmp_path):
    old = document
    args = {"selector": scope("p3"), "patch": {}, "size_change": {"mode": "chinese_steps", "amount": 1}}
    preview = post(client, old, "preview", **args)
    assert preview["changes"][0]["size_before"] == [12, 13]
    assert preview["changes"][0]["size_after"] == [14]
    assert client.get(f"/api/projects/{old['id']}").json() == old
    changed = post(client, old, "apply", **args)
    assert [r["index"] for r in block(changed)["runs"]] == [0, 2]
    assert [r["format"]["size_pt"] for r in block(changed)["runs"]] == [14, 14]
    changed = post(
        client,
        changed,
        "apply",
        selector=scope("p3"),
        patch={},
        size_change={"mode": "points", "amount": 0.5},
    )
    assert block(changed)["format"]["size_pt"] == 14.5
    base = f"/api/projects/{old['id']}"
    package = DocxPackage(client.get(base + "/export/docx").content)
    runs = list(package.by_id["p3"].iter(q("r")))
    assert value(runs[0], "w:rPr/w:sz") == "29" and value(runs[2], "w:rPr/w:sz") == "29"
    assert runs[1].find(q("rPr")) is None, "没有文字的 run 不加入相对字号范围"
    assert value(runs[2], "w:rPr/w:i") is None and runs[2].find(q("rPr")).find(q("i")) is not None
    bundle = client.get(base + "/export/project").content
    store = ProjectStore(tmp_path / "portable")
    imported = store.import_file(bundle, "portable.sdoc")
    assert store.view(imported)["blocks"] == changed["blocks"]
    undone = post(client, changed, "undo")
    assert block(undone)["format"]["size_pt"] == 14
    reset = post(client, undone, "overrides/clear", ids=["p3"], keys=["size_pt"])
    assert block(reset)["runs"] == block(old)["runs"]
    assert client.get(base + "/export/docx").content == client.app.state.store.source(old["id"])


def test_relative_points_keep_differences_and_uniform_replaces_frozen_sizes(client, document):
    changed = post(
        client,
        document,
        "apply",
        selector=scope("p3"),
        patch={"italic": False},
        size_change={"mode": "points", "amount": 1},
    )
    assert [r["format"]["size_pt"] for r in block(changed)["runs"]] == [13, 14]
    assert all(r["format"]["italic"] is False for r in block(changed)["runs"])
    changed = post(client, changed, "apply", selector=scope("p3"), patch={"size_pt": 16})
    assert client.app.state.store.load(changed["id"]).annotations["p3"].sizes is None
    assert block(changed)["format"]["size_pt"] == 16


@pytest.mark.parametrize(
    "start,amount,expected",
    [(12, 1, 14), (13, 1, 14), (13, -1, 12), (13, 2, 15), (13, -2, 10.5), (36, 1, 42), (5.5, -1, 5)],
)
def test_chinese_size_steps(start, amount, expected):
    assert shifted_size(start, SizeChange(mode="chinese_steps", amount=amount), "p1") == expected


def test_relative_bounds_unknown_and_conflicting_inputs_fail_atomically(client, document, source):
    doc = post(client, document, "apply", selector=scope("p5"), patch={"size_pt": 200})
    response = client.post(
        f"/api/projects/{doc['id']}/apply",
        json={
            "revision": doc["revision"],
            "selector": scope("p3", "p5"),
            "patch": {},
            "size_change": {"mode": "points", "amount": 1},
        },
    )
    assert response.status_code == 400 and "P5" in response.json()["detail"]
    assert client.get(f"/api/projects/{doc['id']}").json() == doc
    for change, patch in [
        ({"mode": "points", "amount": 0}, {}),
        ({"mode": "chinese_steps", "amount": 0.5}, {}),
        ({"mode": "points", "amount": 1}, {"size_pt": 12}),
    ]:
        assert (
            client.post(
                f"/api/projects/{doc['id']}/preview",
                json={
                    "revision": doc["revision"],
                    "selector": scope("p3"),
                    "patch": patch,
                    "size_change": change,
                },
            ).status_code
            == 422
        )
    package = DocxPackage(source)
    default = package.styles.find(".//" + q("rPrDefault") + "/" + q("rPr"))
    default.remove(default.find(q("sz")))
    unknown = client.post(
        "/api/projects/import",
        files={
            "file": (
                "unknown.docx",
                replace_parts(source, {"word/styles.xml": etree.tostring(package.styles)}),
            )
        },
    ).json()
    response = client.post(
        f"/api/projects/{unknown['id']}/apply",
        json={
            "revision": unknown["revision"],
            "selector": scope("p3"),
            "patch": {},
            "size_change": {"mode": "points", "amount": 1},
        },
    )
    assert response.status_code == 400 and "无法解析" in response.json()["detail"]


def test_chapters_sections_recompute_and_compose_with_rules(client, document):
    assert block(document, "p7")["section_id"] == "sec1" and block(document, "p8")["section_id"] == "sec2"
    assert block(document, "p6")["chapter_ids"] == ["p4", "p6"]
    assert block(document, "p10")["chapter_ids"] == ["p8"], "表格内标题不切断章节"
    base = f"/api/projects/{document['id']}"
    selector = {
        "mode": "expression",
        "conditions": [
            {"key": "A", "field": "chapter", "value": "p4"},
            {"key": "B", "field": "role", "value": "body"},
        ],
        "expression": "$A AND $B",
    }
    assert client.post(base + "/select", json=selector).json()["ids"] == ["p7"]
    item = {"id": "a" * 32, "name": "章节正文", "selector": selector, "patch": {"keep_next": True}}
    doc = post(client, document, "rules/apply", action="save", rule=item)
    assert block(doc, "p7")["format"]["keep_next"] is True
    doc = post(client, doc, "annotate", ids=["p4"], role="body")
    assert "p4" not in [c["id"] for c in doc["chapters"]]
    assert doc["rules"][0]["matched_count"] == 0
    assert "keep_next" not in block(doc, "p7")["format"]
    assert client.post(base + "/select", json={"conditions": [{"field": "section", "value": "sec1"}]}).json()[
        "ids"
    ] == [f"p{i}" for i in range(1, 8)]


def test_boolean_format_false_overrides_inheritance_and_export_report(client, document):
    patch = {
        "bold": False,
        "italic": True,
        "page_break_before": True,
        "keep_next": False,
        "keep_lines": True,
        "widow_control": False,
    }
    doc = post(client, document, "apply", selector=scope("p4"), patch=patch)
    base = f"/api/projects/{doc['id']}"
    data = client.get(base + "/export/docx").content
    package = DocxPackage(data)
    p4 = package.by_id["p4"]
    assert value(p4, "w:pPr/w:keepNext") == "0" and value(p4, "w:pPr/w:widowControl") == "0"
    assert value(p4, "w:r/w:rPr/w:b") == "0"
    exported = project_document(package)
    for key, val in patch.items():
        assert block(exported, "p4")["format"][key] == val
    report = client.get(base + "/export/report").json()
    assert report["verified"] and report["unselected_preserved"] and report["text_preserved"]
    assert report["changed_parts"] == ["word/document.xml"]
    assert [b["id"] for b in report["changed_paragraphs"]] == ["p4"]
    assert report["revision"] == doc["revision"]
    assert client.get(base).json()["revision"] == doc["revision"]


def test_audit_detects_wrong_scope_text_and_other_parts(source):
    package = DocxPackage(source)
    text = package.by_id["p3"].find(".//" + q("t"))
    text.text = "意外文本变化"
    with pytest.raises(ValueError, match="非预期"):
        audit_export(source, package.replace_document(), {"p3"})
    package = DocxPackage(source)
    etree.SubElement(package.by_id["p3"].find(q("pPr")), q("keepNext"))
    with pytest.raises(ValueError, match="非预期"):
        audit_export(source, package.replace_document(), {"p5"})
    with pytest.raises(ValueError, match="非预期"):
        audit_export(source, replace_parts(source, {"word/styles.xml": b"<changed/>"}), set())


def test_v3_migration_preserves_rules_and_rejects_bad_run_ids(client, document):
    store = client.app.state.store
    path = store.folder(document["id"]) / "project.json"
    legacy = json.loads(path.read_bytes())
    legacy["version"] = 3
    for annotation in legacy["annotations"].values():
        annotation.pop("sizes", None)
    raw = json.dumps(legacy).encode()
    path.write_bytes(raw)
    reloaded = client.get(f"/api/projects/{document['id']}").json()
    assert reloaded["blocks"] == document["blocks"]
    assert json.loads(path.read_bytes())["version"] == 5
    assert reloaded["revision"] == document["revision"] + 1
    doc = post(
        client, reloaded, "apply", selector=scope("p3"), patch={}, size_change={"mode": "points", "amount": 1}
    )
    assert json.loads(path.read_bytes())["version"] == 5
    bundle = client.get(f"/api/projects/{doc['id']}/export/project").content
    with zipfile.ZipFile(io.BytesIO(bundle)) as archive:
        state = json.loads(archive.read("project.json"))
    state["annotations"]["p3"]["sizes"]["runs"]["999"] = 14
    bad = replace_parts(bundle, {"project.json": json.dumps(state).encode()})
    assert client.post("/api/projects/import", files={"file": ("bad.sdoc", bad)}).status_code == 400


def test_missing_negated_chapter_cannot_expand_rule_and_undo_restores_it(client, document):
    selector = {"conditions": [{"field": "chapter", "op": "is_not", "value": "p4"}]}
    item = {"id": "b" * 32, "name": "章节外", "selector": selector, "patch": {"size_pt": 20}}
    doc = post(client, document, "rules/apply", action="save", rule=item)
    assert doc["rules"][0]["matched_count"] > 0
    doc = post(client, doc, "annotate", ids=["p4"], role="body")
    assert doc["rules"][0]["matched_count"] == 0
    assert "范围已失效" in doc["rules"][0]["scope_warning"]
    base = f"/api/projects/{doc['id']}"
    response = client.post(base + "/select", json=selector)
    assert response.status_code == 400 and "已不存在" in response.json()["detail"]
    assert any("范围已失效" in item for item in client.get(base + "/export/report").json()["warnings"])
    assert all(b["format"] == block(document, b["id"])["format"] for b in doc["blocks"])
    restored = post(client, doc, "undo")
    assert restored["rules"][0]["matched_count"] > 0 and not restored["rules"][0]["scope_warning"]


def test_frozen_relative_sizes_survive_rule_changes_until_cleared(client, document):
    rule = {"id": "c" * 32, "name": "基准字号", "selector": scope("p3"), "patch": {"size_pt": 16}}
    doc = post(client, document, "rules/apply", action="save", rule=rule)
    frozen = post(
        client, doc, "apply", selector=scope("p3"), patch={}, size_change={"mode": "points", "amount": 1}
    )
    assert block(frozen)["format"]["size_pt"] == 17
    doc = post(client, frozen, "rules/apply", action="save", rule={**rule, "patch": {"size_pt": 22}})
    assert block(doc)["format"]["size_pt"] == 17
    assert doc["rules"][0]["effective_count"] == 0
    base = f"/api/projects/{doc['id']}"
    exported = project_document(DocxPackage(client.get(base + "/export/docx").content))
    assert block(exported)["format"]["size_pt"] == 17
    stale = client.post(
        base + "/apply",
        json={
            "revision": frozen["revision"],
            "selector": scope("p3"),
            "patch": {},
            "size_change": {"mode": "points", "amount": 1},
        },
    )
    assert stale.status_code == 409
    doc = post(client, doc, "overrides/clear", ids=["p3"], keys=["size_pt"])
    assert block(doc)["format"]["size_pt"] == 22


def test_empty_paragraph_relative_size_uses_its_marker(client, source):
    package = DocxPackage(source)
    paragraph = package.by_id["p3"]
    for child in list(paragraph):
        if child.tag != q("pPr"):
            paragraph.remove(child)
    mark = etree.SubElement(paragraph.find(q("pPr")), q("rPr"))
    etree.SubElement(mark, q("sz"), {q("val"): "26"})
    doc = client.post(
        "/api/projects/import", files={"file": ("empty.docx", package.replace_document())}
    ).json()
    doc = post(
        client,
        doc,
        "apply",
        selector=scope("p3"),
        patch={},
        size_change={"mode": "chinese_steps", "amount": -1},
    )
    assert block(doc)["runs"] == [] and block(doc)["format"]["size_pt"] == 12
    exported = DocxPackage(client.get(f"/api/projects/{doc['id']}/export/docx").content)
    assert value(exported.by_id["p3"], "w:pPr/w:rPr/w:sz") == "24"


def test_theme_direct_override_languages_and_fixed_line_spacing(source):
    package = DocxPackage(compatibility_source(source))
    p3 = package.by_id["p3"]
    run = p3.find(q("r"))
    rpr = etree.SubElement(run, q("rPr"))
    etree.SubElement(rpr, q("rFonts"), {q("ascii"): "Direct Latin"})
    etree.SubElement(rpr, q("lang"), {q("eastAsia"): "ja-JP"})
    ppr = p3.find(q("pPr"))
    etree.SubElement(ppr, q("spacing"), {q("lineRule"): "exact", q("line"): "360"})
    doc = project_document(DocxPackage(package.replace_document()))
    assert block(doc)["runs"][0]["format"]["font_latin"] == "Direct Latin"
    assert block(doc)["runs"][0]["format"]["font_east_asia"] == "Theme Japan"
    assert block(doc)["format"]["line_spacing_pt"] == 18
    assert block(doc)["format"]["line_spacing_rule"] == "exact"
    assert "line_spacing" not in block(doc)["format"]


def test_audit_rejects_structural_changes_even_within_selected_paragraph(source):
    package = DocxPackage(source)
    etree.SubElement(package.body, q("bookmarkStart"), {q("id"): "999"})
    with pytest.raises(ValueError, match="非预期"):
        audit_export(source, package.replace_document(), {"p3"})
    package = DocxPackage(source)
    etree.SubElement(package.by_id["p3"], q("drawing"))
    with pytest.raises(ValueError, match="非预期"):
        audit_export(source, package.replace_document(), {"p3"})
