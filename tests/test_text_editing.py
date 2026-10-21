import io
import zipfile

import pytest
from structured_editor.docx.package import DocxPackage


def edit(client, view, **operation):
    return client.post(f'/api/projects/{view["id"]}/text', json={'revision': view['revision'], **operation})


def test_blank_title_split_ids_history_and_roundtrip(client):
    view = client.post('/api/projects/blank').json()
    assert view['text_editing'] and view['blocks'][0]['text_editable']
    view = edit(client, view, action='replace', id='p1', text='开头😀正文').json()
    view = edit(client, view, action='split', id='p1', offset=3).json()
    assert [(b['id'], b['text']) for b in view['blocks']] == [('p1', '开头😀'), ('p2', '正文')]
    view = edit(client, view, action='category', id='p1', role='title').json()
    assert view['blocks'][0]['role'] == 'title'
    assert view['blocks'][0]['format']['size_pt'] == 24
    view = client.post(f'/api/projects/{view["id"]}/apply', json={
        'revision': view['revision'], 'selector': {'mode': 'all', 'conditions': [{'field': 'ids', 'op': 'is', 'ids': ['p2']}]},
        'patch': {'size_pt': 16},
    }).json()
    assert view['blocks'][1]['format']['size_pt'] == 16
    view = edit(client, view, action='replace', id='p2', text='改后的正文').json()
    for expected_text, expected_size in [('正文', 16), ('正文', 12)]:
        view = client.post(f'/api/projects/{view["id"]}/undo', json={'revision': view['revision']}).json()
        assert view['blocks'][1]['text'] == expected_text
        assert view['blocks'][1]['format']['size_pt'] == expected_size
    view = edit(client, view, action='delete', id='p1').json()
    assert view['blocks'][0]['id'] == 'p2'
    view = edit(client, view, action='split', id='p2', offset=2).json()
    assert [b['id'] for b in view['blocks']] == ['p2', 'p3']
    exported = client.get(f'/api/projects/{view["id"]}/export/docx')
    assert exported.status_code == 200
    package = DocxPackage(exported.content)
    assert ''.join(package.paragraphs[0].itertext()) == '正文'
    assert client.get(f'/api/projects/{view["id"]}/export/report').status_code == 400
    backup = client.get(f'/api/projects/{view["id"]}/export/project').content
    imported = client.post('/api/projects/import', files={'file': ('roundtrip.sdoc', backup)}).json()
    assert imported['text_editing']
    assert imported['blocks'] == view['blocks']


def test_import_requires_enable_preserves_source_and_complex_content(client, rich_source):
    view = client.post('/api/projects/import', files={'file': ('rich.docx', rich_source)}).json()
    assert not view['text_editing']
    assert edit(client, view, action='replace', id='p1', text='不允许').status_code == 400
    view = client.post(f'/api/projects/{view["id"]}/enable-text', json={'revision': view['revision']}).json()
    assert view['text_editing']
    complex_block = next(b for b in view['blocks'] if b['id'] == 'p3')
    assert not complex_block['text_editable']
    assert edit(client, view, action='replace', id='p3', text='不应丢失链接图片').status_code == 400
    target = next(b for b in view['blocks'] if b['text_editable'] and b['in_table'])
    old_revision = view['revision']
    view = edit(client, view, action='replace', id=target['id'], text='表格里的新正文').json()
    assert edit(client, {**view, 'revision': old_revision}, action='replace', id=target['id'], text='过期').status_code == 409
    output = client.get(f'/api/projects/{view["id"]}/export/docx').content
    with zipfile.ZipFile(io.BytesIO(rich_source)) as old, zipfile.ZipFile(io.BytesIO(output)) as new:
        assert old.namelist() == new.namelist()
        for name in old.namelist():
            if name != 'word/document.xml':
                assert old.read(name) == new.read(name)
    original_package, exported_package = DocxPackage(rich_source), DocxPackage(output)
    from lxml import etree
    assert etree.tostring(original_package.by_id['p3']) == etree.tostring(exported_package.by_id['p3'])
    assert client.app.state.store.source(view['id']) == rich_source
    reopened = client.post('/api/projects/import', files={'file': ('rich.docx', rich_source)}).json()
    assert not reopened['text_editing'] and reopened['id'] != view['id']


def test_unchanged_text_keeps_mixed_runs_and_enable_history(client, source):
    view = client.post('/api/projects/import', files={'file': ('sample.docx', source)}).json()
    view = client.post(f'/api/projects/{view["id"]}/enable-text', json={'revision': view['revision']}).json()
    first = view['blocks'][0]
    same = edit(client, view, action='replace', id=first['id'], text=first['text']).json()
    assert same['revision'] == view['revision']
    changed = edit(client, view, action='replace', id=first['id'], text=first['text'] + '追加').json()
    restored = client.post(f'/api/projects/{view["id"]}/undo', json={'revision': changed['revision']}).json()
    assert restored['blocks'][0]['text'] == first['text']
    assert restored['text_editing']


def test_legacy_native_enters_same_workbench(client):
    native = client.post('/api/native').json()
    original_id = native['content']['blocks'][0]['id']
    native['content']['blocks'][0]['text'] = '旧原生内容'
    native = client.post(f'/api/native/{native["id"]}/save', json={'revision': native['revision'], 'content': native['content']}).json()
    items = client.get('/api/projects').json()
    assert len(items) == 1
    view = client.get(f'/api/projects/{items[0]["id"]}').json()
    assert view['text_editing'] and view['blocks'][0]['text'] == '旧原生内容'
    assert len(client.get('/api/projects').json()) == 1
    undone = client.post(f'/api/projects/{view["id"]}/undo', json={'revision': view['revision']}).json()
    assert undone['blocks'][0]['text'] == ''
    assert client.get(f'/api/native/{native["id"]}').json()['content']['blocks'][0]['id'] == original_id


@pytest.mark.parametrize('operation', [
    {'action': 'split', 'offset': 999}, {'action': 'join'}, {'action': 'delete'},
    {'action': 'replace', 'text': '\x00'}, {'action': 'category', 'role': 'heading'},
])
def test_failed_edit_does_not_change_saved_state(client, operation):
    view = client.post('/api/projects/blank').json()
    response = edit(client, view, id='p1', **operation)
    assert response.status_code in (400, 422)
    assert client.get(f'/api/projects/{view["id"]}').json() == view


def test_snapshot_restores_in_new_store_and_template_history(client, tmp_path, monkeypatch):
    from fastapi.testclient import TestClient
    from structured_editor.api import create_app
    view = client.post('/api/projects/blank').json()
    view = edit(client, view, action='replace', id='p1', text='先写内容').json()
    view = edit(client, view, action='split', id='p1', offset=4).json()
    view = edit(client, view, action='category', id='p2', role='heading', level=2).json()
    response = client.post(f'/api/projects/{view["id"]}/templates/apply', json={
        'revision': view['revision'], 'selector': None,
        'template': {'version': 1, 'name': '模板', 'entries': [{'role': 'heading', 'patch': {'size_pt': 22}}]},
    })
    assert response.status_code == 200, response.text
    view = response.json()
    backup = client.get(f'/api/projects/{view["id"]}/export/project').content
    with TestClient(create_app(tmp_path / 'restored')) as other:
        restored = other.post('/api/projects/import', files={'file': ('edited.sdoc', backup)})
        assert restored.status_code == 200, restored.text
        restored = restored.json()
        assert restored['blocks'] == view['blocks']
        restored = other.post(f'/api/projects/{restored["id"]}/undo', json={'revision': restored['revision']}).json()
        assert restored['blocks'][1]['format']['size_pt'] == 15
        restored = other.post(f'/api/projects/{restored["id"]}/redo', json={'revision': restored['revision']}).json()
        assert restored['blocks'][1]['format']['size_pt'] == 22
        # Editable export must never invoke the preservation-only text audit.
        def forbidden(*args):
            raise AssertionError('old audit called')
        monkeypatch.setattr('structured_editor.storage.audit_export', forbidden)
        assert other.get(f'/api/projects/{restored["id"]}/export/docx').status_code == 200


def test_replace_keeps_unedited_run_formatting(client, source):
    from lxml import etree
    from structured_editor.docx.xml import q
    package = DocxPackage(source)
    paragraph = package.by_id['p1']
    for node in list(paragraph):
        if node.tag != q('pPr'):
            paragraph.remove(node)
    for text, size in [('粗体开头', '40'), ('普通结尾', '22')]:
        run = etree.SubElement(paragraph, q('r'))
        props = etree.SubElement(run, q('rPr'))
        etree.SubElement(props, q('sz'), {q('val'): size})
        etree.SubElement(run, q('t')).text = text
    view = client.post('/api/projects/import', files={'file': ('mixed.docx', package.replace_document())}).json()
    view = client.post(f'/api/projects/{view["id"]}/enable-text', json={'revision': view['revision']}).json()
    view = edit(client, view, action='replace', id='p1', text='粗体开头中间普通结尾').json()
    output = DocxPackage(client.get(f'/api/projects/{view["id"]}/export/docx').content)
    runs = output.by_id['p1'].findall(q('r'))
    assert runs[0].find(f'{q("rPr")}/{q("sz")}').get(q('val')) == '40'
    assert runs[-1].find(f'{q("rPr")}/{q("sz")}').get(q('val')) == '22'


@pytest.mark.parametrize('marker_pair', [('permStart', 'permEnd'), ('bookmarkStart', 'bookmarkEnd'), ('proofErr', 'proofErr')])
def test_range_markers_allow_typing_and_survive_split_join_undo(client, source, marker_pair):
    from lxml import etree
    from structured_editor.docx.editing import paragraph_text, text_markers
    from structured_editor.docx.xml import q
    package = DocxPackage(source)
    paragraph = package.by_id['p1']
    # Common Word metadata around ordinary text must not lock the whole paragraph.
    start = etree.Element(q(marker_pair[0]), {q('id'): '42', q('name'): 'range'})
    end = etree.Element(q(marker_pair[1]), {q('id'): '42'})
    if marker_pair[0] == 'permStart':
        start.attrib.pop(q('name'))
        start.set(q('edGrp'), 'everyone')
    if marker_pair[0] == 'proofErr':
        start.attrib.clear()
        start.set(q('type'), 'spellStart')
        end.attrib.clear()
        end.set(q('type'), 'spellEnd')
    paragraph.insert(1, start)
    paragraph.append(end)
    original = package.replace_document()
    view = client.post('/api/projects/import', files={'file': ('markers.docx', original)}).json()
    assert not view['text_editing']
    view = client.post(f'/api/projects/{view["id"]}/enable-text', json={'revision': view['revision']}).json()
    assert view['blocks'][0]['text_editable']
    view = edit(client, view, action='replace', id='p1', text='范围内的新正文').json()
    expected_markers = [(start.tag, dict(start.attrib)), (end.tag, dict(end.attrib))]

    def exported():
        return DocxPackage(client.get(f'/api/projects/{view["id"]}/export/docx').content)

    changed = exported()
    assert paragraph_text(changed.by_id['p1']) == '范围内的新正文'
    assert [(node.tag, dict(node.attrib)) for _, node in text_markers(changed.by_id['p1'])] == expected_markers
    assert [pos for pos, _ in text_markers(changed.by_id['p1'])] == [0, 7]
    assert edit(client, view, action='delete', id='p1').status_code == 400
    view = edit(client, view, action='split', id='p1', offset=3).json()
    new_id = view['edit_focus']
    split = exported()
    assert [paragraph_text(p) for p in split.paragraphs[:2]] == ['范围内', '的新正文']
    assert [(node.tag, dict(node.attrib)) for p in split.paragraphs[:2] for _, node in text_markers(p)] == expected_markers
    view = edit(client, view, action='join', id=new_id).json()
    assert paragraph_text(exported().by_id['p1']) == '范围内的新正文'
    assert [(node.tag, dict(node.attrib)) for _, node in text_markers(exported().by_id['p1'])] == expected_markers
    view = client.post(f'/api/projects/{view["id"]}/undo', json={'revision': view['revision']}).json()
    assert len(view['blocks']) == len(package.paragraphs) + 1
    assert client.app.state.store.source(view['id']) == original


def test_rendered_page_hint_does_not_lock_text_or_disappear(client, source):
    from lxml import etree
    from structured_editor.docx.editing import paragraph_text
    from structured_editor.docx.xml import q
    package = DocxPackage(source)
    run = package.by_id['p1'].find(q('r'))
    hint = etree.SubElement(run, q('lastRenderedPageBreak'))
    assert hint is not None
    view = client.post('/api/projects/import', files={'file': ('page-hint.docx', package.replace_document())}).json()
    view = client.post(f'/api/projects/{view["id"]}/enable-text', json={'revision': view['revision']}).json()
    assert view['blocks'][0]['text_editable']
    view = edit(client, view, action='replace', id='p1', text='分页提示不妨碍写作').json()
    output = DocxPackage(client.get(f'/api/projects/{view["id"]}/export/docx').content)
    assert paragraph_text(output.by_id['p1']) == '分页提示不妨碍写作'
    assert len(output.by_id['p1'].findall(f'.//{q("lastRenderedPageBreak")}')) == 1
