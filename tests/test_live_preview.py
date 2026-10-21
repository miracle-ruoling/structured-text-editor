from structured_editor.domain.pagination import pagination_warnings


def scope(*ids):
    return {"conditions": [{"field": "ids", "ids": list(ids)}]}


def test_compact_live_preview_matches_full_and_stays_read_only(client):
    doc = client.post("/api/projects/demo").json()
    base = f"/api/projects/{doc['id']}"
    store = client.app.state.store
    path = store.folder(doc["id"]) / "project.json"
    original = path.read_bytes()
    args = {
        "revision": doc["revision"],
        "selector": scope("p3", "p5"),
        "patch": {"bold": False, "first_line_chars": 2},
        "size_change": {"mode": "chinese_steps", "amount": 2},
    }
    full = client.post(base + "/preview", json=args).json()
    compact_response = client.post(base + "/preview?compact=true", json=args)
    assert compact_response.status_code == 200
    compact = compact_response.json()
    assert compact["changes"] == full["changes"]
    assert compact["ids"] == ["p3", "p5"]
    assert len(compact_response.content) < len(client.post(base + "/preview", json=args).content)
    assert all(set(b) == {"id", "format", "runs", "mixed"} for b in compact["after_blocks"])
    assert path.read_bytes() == original
    applied = client.post(base + "/apply", json=args).json()
    by_id = {b["id"]: b for b in applied["blocks"]}
    for result in compact["after_blocks"]:
        assert all(by_id[result["id"]][key] == value for key, value in result.items())
    # A completed preview may not overwrite another saved revision.
    assert client.post(base + "/apply", json=args).status_code == 409


def test_live_steps_compute_from_saved_state_and_commit_only_once(client):
    doc = client.post("/api/projects/demo").json()
    base = f"/api/projects/{doc['id']}"
    args = {"revision": doc["revision"], "selector": scope("p3"), "patch": {}}
    for amount, expected in [(1, 14), (2, 15), (1, 14), (-1, 10.5)]:
        result = client.post(
            base + "/preview?compact=true",
            json={**args, "size_change": {"mode": "chinese_steps", "amount": amount}},
        )
        assert result.status_code == 200, result.text
        assert result.json()["changes"][0]["size_after"] == [expected]
    assert client.get(base).json() == doc
    final = client.post(
        base + "/apply", json={**args, "size_change": {"mode": "chinese_steps", "amount": 1}}
    ).json()
    assert final["revision"] == doc["revision"] + 1
    undone = client.post(base + "/undo", json={"revision": final["revision"]}).json()
    assert undone["blocks"] == doc["blocks"]


def test_pagination_preview_warns_on_boundary_not_flags_on_one_heading(client):
    doc = client.post("/api/projects/demo").json()
    base = f"/api/projects/{doc['id']}"
    patch = {"page_break_before": True, "keep_next": True}
    args = {"revision": doc["revision"], "selector": scope("p3"), "patch": patch}
    assert client.post(base + "/preview", json=args).json()["warnings"] == []
    args["selector"] = scope("p3", "p4")
    preview = client.post(base + "/preview?compact=true", json=args).json()
    assert "P3 → P4" in preview["warnings"][0]
    assert client.get(base).json() == doc
    result = client.post(base + "/apply", json=args)
    assert result.status_code == 200
    assert any("P3 → P4" in w for w in client.get(base + "/export/report").json()["warnings"])
    # Conflicts include inherited/saved properties outside the new selection.
    saved = result.json()
    reset = {"revision": saved["revision"], "selector": scope("p3"), "patch": {"keep_next": False}}
    assert client.post(base + "/preview", json=reset).json()["warnings"] == []


def test_pagination_only_connects_paragraphs_in_same_flow():
    blocks = [
        {"id": "p1", "format": {"keep_next": True}},
        {"id": "p2", "format": {"page_break_before": True}},
    ]
    p1, p2 = [{"kind": "paragraph", "id": b["id"]} for b in blocks]
    table = {"kind": "table", "rows": [[{"children": [p1]}, {"children": [p2]}]]}
    assert pagination_warnings({"blocks": blocks, "layout": [table]}, {"p1", "p2"}) == []
    assert pagination_warnings({"blocks": blocks, "layout": [p1, p2]}, {"p2"})
    assert pagination_warnings({"blocks": blocks, "layout": [p1, p2]}, {"p3"}) == []
