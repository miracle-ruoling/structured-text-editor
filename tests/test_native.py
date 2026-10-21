import io
import json
import zipfile
from uuid import uuid4

import pytest
from lxml import etree
from structured_editor.docx.package import DocxPackage
from structured_editor.docx.reader import project_document
from structured_editor.docx.xml import q
from structured_editor.native_store import NativeStore


def create(client):
    response = client.post('/api/native')
    assert response.status_code == 200
    return response.json()


def save(client, view, content):
    return client.post(f'/api/native/{view["id"]}/save', json={
        'revision': view['revision'], 'content': content,
    })


def test_native_content_history_and_reopen(client):
    view = create(client)
    original = view['content']
    first_id = original['blocks'][0]['id']
    second_id = uuid4().hex
    content = {'name': '测试原生', 'blocks': [
        {'id': first_id, 'kind': 'heading', 'level': 2, 'text': '标题'},
        {'id': second_id, 'kind': 'paragraph', 'level': None, 'text': '正文'},
    ]}
    view = save(client, view, content).json()
    assert view['content'] == content and view['can_undo']
    assert save(client, view, content).json()['revision'] == view['revision']
    assert client.get(f'/api/native/{view["id"]}').json() == view
    stale = save(client, {**view, 'revision': view['revision'] - 1}, original)
    assert stale.status_code == 409
    undone = client.post(f'/api/native/{view["id"]}/history/undo', json={'revision': view['revision']}).json()
    assert undone['content'] == original and undone['can_redo']
    redone = client.post(f'/api/native/{view["id"]}/history/redo', json={'revision': undone['revision']}).json()
    assert redone['content'] == content
    # New store instance reads persisted history, IDs and content, not a cached projection.
    store = NativeStore(client.app.state.store.root)
    assert store.load(view['id']).content.model_dump() == content
    assert store.load(view['id']).undo[0].model_dump() == original
    # Deletion/reordering preserves remaining IDs, undo restores exactly those removed.
    removed = save(client, redone, {**content, 'blocks': [content['blocks'][1]]}).json()
    restored = client.post(f'/api/native/{view["id"]}/history/undo', json={'revision': removed['revision']}).json()
    assert restored['content'] == content
    branched = save(client, restored, {**content, 'name': '新分支'}).json()
    assert not branched['can_redo']


@pytest.mark.parametrize('mutation', ['duplicate', 'bad_id', 'heading', 'unsupported', 'empty', 'control', 'name', 'large'])
def test_native_rejects_invalid_content_without_writing(client, mutation):
    view = create(client)
    content = json.loads(json.dumps(view['content']))
    block = content['blocks'][0]
    if mutation == 'duplicate':
        content['blocks'].append(block.copy())
    elif mutation == 'bad_id':
        block['id'] = 'p1'
    elif mutation == 'heading':
        block['kind'] = 'heading'
    elif mutation == 'unsupported':
        block['image'] = 'fake.png'
    elif mutation == 'empty':
        content['blocks'] = []
    elif mutation == 'control':
        block['text'] = '\x00'
    elif mutation == 'name':
        content['name'] = '../escape'
    else:
        block['text'] = '文' * 100001
    assert save(client, view, content).status_code == 422
    assert client.get(f'/api/native/{view["id"]}').json() == view


def test_native_backup_and_docx_are_separate_from_source_projects(client):
    source = client.post('/api/projects/demo').json()
    source_path = client.app.state.store.folder(source['id']) / 'source.docx'
    source_bytes = source_path.read_bytes()
    view = create(client)
    content = view['content']
    content['blocks'][0].update(kind='heading', level=3, text='标题 & <文序>')
    content['blocks'].append({'id': uuid4().hex, 'kind': 'paragraph', 'level': None, 'text': ' 空格\t中文😀\n第二行 '})
    view = save(client, view, content).json()
    prefix = f'/api/native/{view["id"]}/export/'
    response = client.get(prefix + f'project?revision={view["revision"]}')
    restored = client.post('/api/native/import', files={'file': ('备份.wnative.json', response.content)}).json()
    assert restored['content'] == view['content'] and restored['can_undo']
    assert restored['id'] != view['id']
    assert restored['content']['blocks'][0]['id'] == view['content']['blocks'][0]['id']
    backup = response.json()
    backup['version'] = 2
    count = len(client.get('/api/native').json())
    assert client.post('/api/native/import', files={'file': ('bad.json', json.dumps(backup))}).status_code == 400
    assert len(client.get('/api/native').json()) == count
    assert client.get(prefix + f'docx?revision={view["revision"] - 1}').status_code == 409
    docx = client.get(prefix + f'docx?revision={view["revision"]}').content
    with zipfile.ZipFile(io.BytesIO(docx)) as archive:
        assert archive.testzip() is None
        document = etree.fromstring(archive.read('word/document.xml'))
        blocks = document.findall(f'{q("body")}/{q("p")}')
        assert blocks[0].find(f'{q("pPr")}/{q("pStyle")}').get(q('val')) == 'Heading3'
        assert ''.join(blocks[0].itertext()) == '标题 & <文序>'
        assert blocks[1].find(f'{q("r")}/{q("tab")}') is not None
        assert blocks[1].find(f'{q("r")}/{q("br")}') is not None
    projected = project_document(DocxPackage(docx))
    assert len(projected['blocks']) == 2
    assert projected['blocks'][0]['text'] == '标题 & <文序>'
    assert source_path.read_bytes() == source_bytes
    assert client.get(f'/api/projects/{source["id"]}').json()['revision'] == source['revision']


def test_native_history_limit_and_noop(client):
    view = create(client)
    for index in range(54):
        view = save(client, view, {**view['content'], 'name': f'版本 {index}'}).json()
    store = NativeStore(client.app.state.store.root)
    assert len(store.load(view['id']).undo) == 50
    before = store.path(view['id']).read_bytes()
    assert client.post(f'/api/native/{view["id"]}/history/redo', json={'revision': view['revision']}).json() == view
    assert store.path(view['id']).read_bytes() == before


def test_native_failed_atomic_save_keeps_prior_document(client, monkeypatch):
    view = create(client)
    store = NativeStore(client.app.state.store.root)
    before = store.path(view['id']).read_bytes()
    def fail(*args):
        raise OSError('disk failure')
    monkeypatch.setattr('structured_editor.storage.os.replace', fail)
    with pytest.raises(OSError, match='disk failure'):
        save(client, view, {**view['content'], 'name': '未写入'})
    assert store.path(view['id']).read_bytes() == before
