"""Read-only preview timing; generated sources and projects stay in .artifacts."""

import argparse
import json
import statistics
import tempfile
from copy import deepcopy
from pathlib import Path
from time import perf_counter

from structured_editor.docx.package import DocxPackage
from structured_editor.docx.sample import create_sample
from structured_editor.domain.models import FormatRequest
from structured_editor.storage import ProjectStore


def measure(source, name, label, root):
    store = ProjectStore(root)
    project = store.import_file(source, name)
    view = store.view(project)
    request = FormatRequest.model_validate(
        {
            "revision": project.revision,
            "selector": {"conditions": []},
            "patch": {"first_line_chars": 2},
            "size_change": {"mode": "chinese_steps", "amount": 1},
        }
    )
    path = store.folder(project.id) / "project.json"
    saved = path.read_bytes()
    measurements = []
    for _ in range(3):
        start = perf_counter()
        preview = store.preview(project, request, compact=True)
        payload = json.dumps(preview, ensure_ascii=False).encode()
        measurements.append(round((perf_counter() - start) * 1000))
    assert path.read_bytes() == saved
    return {
        "sample": label,
        "paragraphs": len(view["blocks"]),
        "selected": len(preview["ids"]),
        "preview_and_json_ms": measurements,
        "median_ms": statistics.median(measurements),
        "response_kib": round(len(payload) / 1024),
        "saved_unchanged": True,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--paragraphs", type=int, default=2000)
    parser.add_argument("--docx", type=Path)
    args = parser.parse_args()
    if not 1 <= args.paragraphs <= 20000:
        parser.error("paragraphs must be 1..20000")
    root = Path(__file__).resolve().parents[1] / ".artifacts" / "test-runs"
    root.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="preview-bench-", dir=root) as temp:
        package = DocxPackage(create_sample())
        paragraph = deepcopy(package.by_id["p3"])
        package.body.clear()
        for _ in range(args.paragraphs):
            package.body.append(deepcopy(paragraph))
        results = [
            measure(package.replace_document(), "generated.docx", "generated", Path(temp) / "generated")
        ]
        if args.docx:
            source = args.docx.read_bytes()
            results.append(measure(source, args.docx.name, "real-document", Path(temp) / "real"))
            assert args.docx.read_bytes() == source
        output = root.parent / "live-preview-benchmark.json"
        output.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps(results, ensure_ascii=False))


if __name__ == "__main__":
    main()
