from lxml import etree
from structured_editor.docx.package import DocxPackage
from structured_editor.docx.reader import project_document
from structured_editor.docx.xml import q
from structured_editor.storage import ProjectStore


def test_duplicate_docx_import_resumes_latest_project(client, source):
    first = client.post("/api/projects/import", files={"file": ("sample.docx", source)}).json()
    changed = client.post(
        f"/api/projects/{first['id']}/annotate",
        json={
            "revision": first["revision"],
            "ids": ["p3"],
            "tags": ["保留修改"],
        },
    ).json()
    repeated = client.post("/api/projects/import", files={"file": ("sample (1).docx", source)}).json()
    assert repeated["id"] == first["id"]
    assert repeated["blocks"] == changed["blocks"]
    assert len(client.get("/api/projects").json()) == 1


def test_download_does_not_create_project_or_revision(client):
    doc = client.post("/api/projects/demo").json()
    before = client.get("/api/projects").json()
    for kind in ("project", "docx", "project"):
        assert client.get(f"/api/projects/{doc['id']}/export/{kind}").status_code == 200
    assert client.get("/api/projects").json() == before
    assert client.get(f"/api/projects/{doc['id']}").json()["revision"] == doc["revision"]


def test_different_snapshot_is_named_separately_and_old_work_is_preserved(client):
    doc = client.post("/api/projects/demo").json()
    bundle = client.get(f"/api/projects/{doc['id']}/export/project").content
    changed = client.post(
        f"/api/projects/{doc['id']}/annotate",
        json={
            "revision": doc["revision"],
            "ids": ["p3"],
            "tags": ["新状态"],
        },
    ).json()
    restored = client.post("/api/projects/import", files={"file": ("backup.sdoc", bundle)}).json()
    assert restored["id"] != doc["id"]
    assert restored["name"] != changed["name"]
    assert restored["blocks"] == doc["blocks"]
    assert client.get(f"/api/projects/{doc['id']}").json()["blocks"] == changed["blocks"]


def test_project_bundle_on_fresh_store_keeps_annotations_and_history(client, tmp_path):
    doc = client.post("/api/projects/demo").json()
    doc = client.post(
        f"/api/projects/{doc['id']}/annotate",
        json={
            "revision": doc["revision"],
            "ids": ["p3"],
            "tags": ["portable"],
        },
    ).json()
    bundle = client.get(f"/api/projects/{doc['id']}/export/project").content
    store = ProjectStore(tmp_path / "other-installation")
    imported = store.import_file(bundle, "portable.sdoc")
    assert imported.id != doc["id"]
    assert store.view(imported)["blocks"] == doc["blocks"]
    assert imported.undo


def test_new_demos_have_distinct_names_and_recent_ids(client):
    demos = [client.post("/api/projects/demo").json() for _ in range(3)]
    assert len({d["name"] for d in demos}) == 3
    recent = client.get("/api/projects").json()
    assert len({d["id"] for d in recent}) == 3
    assert all("revision" in d for d in recent)


def test_add_tag_does_not_silently_confirm_auto_role(client):
    doc = client.post("/api/projects/demo").json()
    result = client.post(
        f"/api/projects/{doc['id']}/annotate",
        json={
            "revision": doc["revision"],
            "ids": ["p3"],
            "tags": ["即时保存"],
        },
    ).json()
    block = next(b for b in result["blocks"] if b["id"] == "p3")
    assert block["tags"] == ["即时保存"]
    assert not block["confirmed"]


def test_report_indentation_is_read_as_complete_context(source):
    package = DocxPackage(source)
    ppr = package.by_id["p3"].find(q("pPr"))
    etree.SubElement(
        ppr,
        q("ind"),
        {
            q("leftChars"): "300",
            q("left"): "2880",
            q("rightChars"): "300",
            q("right"): "720",
            q("hangingChars"): "900",
            q("hanging"): "2160",
        },
    )
    view = project_document(package)
    fmt = next(b for b in view["blocks"] if b["id"] == "p3")["format"]
    assert fmt["left_indent_chars"] == fmt["right_indent_chars"] == 3
    assert fmt["first_line_chars"] == -9
    assert "left_indent_pt" not in fmt


def test_direct_point_indent_replaces_inherited_character_unit(source):
    package = DocxPackage(source)
    normal = next(s for s in package.styles.findall(q("style")) if s.get(q("styleId")) == "Normal")
    etree.SubElement(etree.SubElement(normal, q("pPr")), q("ind"), {q("leftChars"): "300"})
    etree.SubElement(package.by_id["p3"].find(q("pPr")), q("ind"), {q("left"): "720"})
    fmt = next(b for b in project_document(package)["blocks"] if b["id"] == "p3")["format"]
    assert fmt["left_indent_pt"] == 36
    assert "left_indent_chars" not in fmt
