import io
import zipfile

from structured_editor.docx.package import DocxPackage
from structured_editor.docx.xml import value
from structured_editor.storage import ProjectStore

BODY_SELECTOR = {
    "mode": "all",
    "conditions": [
        {"field": "role", "op": "is", "value": "body"},
        {"field": "context", "op": "is_not", "value": "table"},
        {"field": "tag", "op": "is_not", "value": "保留原格式"},
    ],
}


def test_complete_body_format_workflow_preserves_exceptions(client):
    doc = client.post("/api/projects/demo").json()
    base = f"/api/projects/{doc['id']}"
    selected = client.post(base + "/select", json=BODY_SELECTOR).json()["ids"]
    assert selected == ["p3", "p5", "p6", "p9", "p21"]
    request = {
        "revision": doc["revision"],
        "selector": BODY_SELECTOR,
        "patch": {"first_line_chars": 2, "size_pt": 14},
    }
    preview = client.post(base + "/preview", json=request)
    assert preview.status_code == 200
    assert preview.json()["ids"] == selected
    assert client.get(base).json()["revision"] == doc["revision"]
    modified = client.post(base + "/apply", json=request).json()
    assert modified["revision"] == doc["revision"] + 1
    assert client.post(base + "/apply", json=request).status_code == 409
    output = client.get(base + "/export/docx")
    assert output.status_code == 200
    package = DocxPackage(output.content)
    for identity, p in package.by_id.items():
        assert value(p, "w:pPr/w:ind", "firstLineChars") == ("200" if identity in selected else None)
    undone = client.post(base + "/undo", json={"revision": modified["revision"]}).json()
    assert all(not b["overrides"] for b in undone["blocks"])
    redone = client.post(base + "/redo", json={"revision": undone["revision"]}).json()
    assert next(b for b in redone["blocks"] if b["id"] == "p3")["overrides"]["first_line_chars"] == 2


def test_manual_annotations_filter_undo_and_portable_project_roundtrip(client):
    doc = client.post("/api/projects/demo").json()
    base = f"/api/projects/{doc['id']}"
    updated = client.post(
        base + "/annotate",
        json={"revision": doc["revision"], "ids": ["p3"], "role": "quote", "tags": [" 自定义 ", "自定义"]},
    ).json()
    block = next(b for b in updated["blocks"] if b["id"] == "p3")
    assert block["role"] == "quote" and block["confirmed"] and block["tags"] == ["自定义"]
    selected = client.post(
        base + "/select", json={"conditions": [{"field": "tag", "value": "自定义"}]}
    ).json()
    assert selected["ids"] == ["p3"]
    persisted = ProjectStore(client.app.state.store.root)
    assert persisted.load(doc["id"]).annotations["p3"].role == "quote"
    bundle = client.get(base + "/export/project")
    imported = client.post("/api/projects/import", files={"file": ("再次打开.sdoc", bundle.content)}).json()
    assert imported["id"] != doc["id"]
    assert imported["blocks"] == updated["blocks"]
    assert imported["undo_label"] == updated["undo_label"]
    undone = client.post(
        f"/api/projects/{imported['id']}/undo", json={"revision": imported["revision"]}
    ).json()
    assert next(b for b in undone["blocks"] if b["id"] == "p3")["role"] == "body"


def test_new_action_discards_redo_and_noop_has_no_history(client):
    doc = client.post("/api/projects/demo").json()
    base = f"/api/projects/{doc['id']}"
    modified = client.post(
        base + "/apply",
        json={"revision": doc["revision"], "selector": BODY_SELECTOR, "patch": {"size_pt": 14}},
    ).json()
    noop = client.post(
        base + "/apply",
        json={"revision": modified["revision"], "selector": BODY_SELECTOR, "patch": {"size_pt": 14}},
    ).json()
    assert noop["revision"] == modified["revision"]
    undone = client.post(base + "/undo", json={"revision": noop["revision"]}).json()
    annotated = client.post(
        base + "/annotate", json={"revision": undone["revision"], "ids": ["p3"], "tags": ["new"]}
    ).json()
    assert annotated["redo_label"] is None


def test_import_errors_do_not_destroy_existing_project(client, source):
    doc = client.post("/api/projects/import", files={"file": ("sample.docx", source)}).json()
    assert client.post("/api/projects/import", files={"file": ("bad.docx", b"broken")}).status_code == 400
    assert client.post("/api/projects/import", files={"file": ("legacy.doc", source)}).status_code == 400
    assert client.get(f"/api/projects/{doc['id']}").status_code == 200


def test_tampered_project_source_is_rejected(client):
    doc = client.post("/api/projects/demo").json()
    bundle = client.get(f"/api/projects/{doc['id']}/export/project").content
    output = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(bundle)) as original, zipfile.ZipFile(output, "w") as target:
        target.writestr(
            "project.json",
            original.read("project.json").replace(b'"source_sha256": "', b'"source_sha256": "0'),
        )
        target.writestr("source.docx", original.read("source.docx"))
    assert (
        client.post("/api/projects/import", files={"file": ("tampered.sdoc", output.getvalue())}).status_code
        == 400
    )


def test_rejects_empty_operation_invalid_id_and_cross_origin(client):
    doc = client.post("/api/projects/demo").json()
    base = f"/api/projects/{doc['id']}"
    assert (
        client.post(
            base + "/preview", json={"revision": doc["revision"], "selector": {}, "patch": {}}
        ).status_code
        == 422
    )
    assert (
        client.post(
            base + "/annotate", json={"revision": doc["revision"], "ids": ["p999"], "role": "body"}
        ).status_code
        == 400
    )
    assert (
        client.post("/api/projects/demo", headers={"Origin": "https://other-site.example"}).status_code == 403
    )


def test_recent_documents_can_be_reopened(client):
    first = client.post("/api/projects/demo").json()
    second = client.post("/api/projects/demo").json()
    recent = client.get("/api/projects").json()
    assert [project["id"] for project in recent] == [second["id"], first["id"]]
    assert client.get(f"/api/projects/{first['id']}").json()["blocks"] == first["blocks"]
