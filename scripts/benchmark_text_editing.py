"""Synthetic HTTP benchmark; never reads user documents or the production data folder."""
from copy import deepcopy
from pathlib import Path
from statistics import median
from tempfile import TemporaryDirectory
from time import perf_counter
from unittest.mock import patch

from fastapi.testclient import TestClient
from structured_editor.api import create_app
from structured_editor.docx.editing import editable_view
from structured_editor.docx.package import DocxPackage
from structured_editor.docx.sample import create_sample
from structured_editor.docx.xml import q
from structured_editor.domain.models import TextEditRequest
from structured_editor.domain.rules import resolve


def source():
    package = DocxPackage(create_sample())
    paragraph = deepcopy(package.paragraphs[2])
    for child in list(package.body):
        if child.tag != q('sectPr'):
            package.body.remove(child)
    for index in range(462):
        node = deepcopy(paragraph)
        node.find('.//' + q('t')).text = f'{index} synthetic paragraph'
        package.body.insert(index, node)
    return package.replace_document()


def measure(data, legacy):
    with TemporaryDirectory() as root:
        app = create_app(Path(root))
        store = app.state.store
        if legacy:
            # Reproduce the former full projection + generic FastAPI encoding path.
            store.base_view = lambda project: editable_view(store.source(project.id), project)

            @app.post('/benchmark/{identity}')
            def old_text(identity: str, operation: TextEditRequest):
                with store.lock:
                    return store.edit_text(store.load(identity), operation)
            app.router.routes.insert(0, app.router.routes.pop())

        with TestClient(app) as client:
            project = store.create(data, 'synthetic.docx')
            store.enable_text(project, project.revision)
            view = store.view(project)
            times = []
            for _ in range(8):
                url = f'/benchmark/{project.id}' if legacy else f'/api/projects/{project.id}/text'
                started = perf_counter()
                response = client.post(url, json={
                    'revision': view['revision'], 'action': 'split', 'id': 'p1', 'offset': 0,
                })
                times.append((perf_counter() - started) * 1000)
                response.raise_for_status()
                view = response.json()
            return {'median_ms': round(median(times), 1), 'range_ms': [round(min(times), 1), round(max(times), 1)]}


if __name__ == '__main__':
    data = source()
    with patch('structured_editor.storage.resolve', lambda view, project, **kw: resolve(view, project)):
        print('previous_path_462_paragraphs:', measure(data, True))
    print('optimized_462_paragraphs:', measure(data, False))
