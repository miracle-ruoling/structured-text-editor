"""Editable snapshots preserve the source package and stable paragraph identities."""
from copy import deepcopy

from lxml import etree

from ..domain.commands import check_revision, touch
from ..domain.models import Annotation, EditableDocument, Snapshot, TextEditRequest
from .package import DocxPackage
from .reader import is_editable, project_document
from .writer import export_docx
from .xml import NS, own_runs, parse, q, run_text


def package_for(source: bytes, content: EditableDocument | None):
    package = DocxPackage(source)
    if content is None:
        return package
    try:
        document = parse(content.xml.encode('utf-8'))
    except (etree.XMLSyntaxError, UnicodeError) as exc:
        raise ValueError('编辑快照 XML 损坏') from exc
    body = document.find(q('body'))
    if document.tag != q('document') or body is None:
        raise ValueError('编辑快照缺少文档主体')
    paragraphs = list(body.iter(q('p')))
    if len(paragraphs) != len(content.ids):
        raise ValueError('编辑快照与段落定位不一致')
    package.document, package.body, package.paragraphs = document, body, paragraphs
    package.by_id = dict(zip(content.ids, paragraphs, strict=True))
    package.ids = {p: identity for identity, p in package.by_id.items()}
    return package


def snapshot(package):
    return EditableDocument(xml=etree.tostring(package.document, encoding='unicode'),
                            ids=[package.ids[p] for p in package.body.iter(q('p'))])


def text_editable(paragraph):
    if not is_editable(paragraph):
        return False
    # Only plain text runs can be changed; anchors, fields and embedded objects stay intact.
    if paragraph.find('w:pPr/w:sectPr', NS) is not None:
        return False
    for child in paragraph:
        if child.tag == q('pPr'):
            continue
        if child.tag != q('r') or any(node.tag not in {q('rPr'), q('t'), q('tab'), q('br'), q('cr')} for node in child):
            return False
        if any(node.get(q('type')) not in (None, 'textWrapping') for node in child if node.tag == q('br')):
            return False
    return True


def paragraph_text(paragraph):
    return ''.join(run_text(run) for run in own_runs(paragraph))


def append_text(parent, text, rpr=None):
    if not text:
        return
    run = etree.SubElement(parent, q('r'))
    if rpr is not None:
        run.append(deepcopy(rpr))
    for i, line in enumerate(text.split('\n')):
        if i:
            etree.SubElement(run, q('br'))
        for j, part in enumerate(line.split('\t')):
            if j:
                etree.SubElement(run, q('tab'))
            etree.SubElement(run, q('t'), {'{http://www.w3.org/XML/1998/namespace}space': 'preserve'}).text = part


def slice_runs(paragraph, start, end):
    runs, pos = [], 0
    for run in own_runs(paragraph):
        text = run_text(run)
        lo, hi = max(0, start - pos), min(len(text), end - pos)
        if hi > lo:
            holder = etree.Element('holder')
            append_text(holder, text[lo:hi], run.find(q('rPr')))
            runs.extend(list(holder))
        pos += len(text)
    return runs


def replace_text(paragraph, text):
    old = paragraph_text(paragraph)
    if old == text:
        return
    prefix = 0
    while prefix < min(len(old), len(text)) and old[prefix] == text[prefix]:
        prefix += 1
    suffix = 0
    while suffix < min(len(old), len(text)) - prefix and old[-1 - suffix] == text[-1 - suffix]:
        suffix += 1
    before = slice_runs(paragraph, 0, prefix)
    after = slice_runs(paragraph, len(old) - suffix, len(old))
    style = None
    pos = 0
    for run in own_runs(paragraph):
        style = run.find(q('rPr'))
        pos += len(run_text(run))
        if pos >= prefix:
            break
    for child in list(paragraph):
        if child.tag != q('pPr'):
            paragraph.remove(child)
    paragraph.extend(before)
    append_text(paragraph, text[prefix:len(text) - suffix if suffix else len(text)], style)
    paragraph.extend(after)


def set_category(paragraph, role, level):
    # Structural style belongs to the explicit new-paragraph category action only.
    props = paragraph.find(q('pPr'))
    if props is None:
        props = etree.Element(q('pPr'))
        paragraph.insert(0, props)
    for key in ('pStyle', 'outlineLvl', 'numPr', 'rPr', 'jc'):
        for node in props.findall(q(key)):
            props.remove(node)
    etree.SubElement(props, q('outlineLvl'), {q('val'): str(level - 1 if role == 'heading' else 9)})
    for run in paragraph.findall(q('r')):
        old = run.find(q('rPr'))
        if old is not None:
            run.remove(old)
    from .writer import write_paragraph
    write_paragraph(paragraph, {'size_pt': 24 if role == 'title' else {1: 18, 2: 15, 3: 13}.get(level, 12),
                                'bold': role in ('title', 'heading'),
                                'alignment': 'center' if role == 'title' else 'left',
                                'keep_next': role in ('title', 'heading')})


def enable_editing(source, project):
    if project.text_editing:
        return False
    package = package_for(source, project.content)
    project.content = snapshot(package)
    project.version = 6
    project.text_editing = True
    project.next_paragraph = max([int(i[1:]) for i in package.by_id] + [0]) + 1
    touch(project)
    return True


def edit_document(source, project, operation: TextEditRequest):
    check_revision(project, operation.revision)
    if not project.text_editing:
        raise ValueError('请先启用文字编辑')
    package = package_for(source, project.content)
    paragraph = package.by_id.get(operation.id)
    if paragraph is None or not text_editable(paragraph):
        raise ValueError('该段含受保护结构，暂不可修改文字')
    text = paragraph_text(paragraph)
    if operation.action == 'replace' and text == operation.text:
        return operation.id
    before = Snapshot(label='文字编辑', annotations=deepcopy(project.annotations),
                      saved_selectors=deepcopy(project.saved_selectors), rules=deepcopy(project.rules),
                      content=deepcopy(project.content))
    # Bake run-index size overrides before changing run segmentation.
    annotation = project.annotations.get(operation.id)
    if annotation and annotation.sizes:
        positional = {f'p{i + 1}': annotation for i, p in enumerate(package.paragraphs) if p is paragraph}
        baked = DocxPackage(export_docx(package.replace_document(), positional))
        index = package.paragraphs.index(paragraph)
        replacement = deepcopy(baked.paragraphs[index])
        paragraph.getparent().replace(paragraph, replacement)
        paragraph = replacement
        package.by_id[operation.id] = paragraph
        package.ids[paragraph] = operation.id
        annotation.sizes = None
    focus = operation.id
    if operation.action == 'replace':
        replace_text(paragraph, operation.text)
    elif operation.action == 'category':
        set_category(paragraph, operation.role, operation.level)
        annotation = project.annotations.setdefault(operation.id, Annotation())
        annotation.role = operation.role
        # Explicit category selection starts from its own format, not old local title overrides.
        annotation.format = type(annotation.format)()
        annotation.sizes = None
    elif operation.action == 'split':
        offset = operation.offset
        if offset > len(text):
            raise ValueError('拆分位置超出段落')
        if len(package.ids) >= 20000:
            raise ValueError('最多支持 20,000 段')
        right = etree.Element(q('p'))
        right.extend(slice_runs(paragraph, offset, len(text)))
        replace_text(paragraph, text[:offset])
        paragraph.addnext(right)
        focus = f'p{project.next_paragraph}'
        project.next_paragraph += 1
        package.ids[right] = focus
        set_category(right, operation.role, operation.level)
        project.annotations[focus] = Annotation(role=operation.role)
    elif operation.action == 'join':
        previous = paragraph.getprevious()
        if previous is None or previous.tag != q('p') or not text_editable(previous):
            raise ValueError('不能跨表格、分节或受保护结构合并段落')
        focus = package.ids[previous]
        # Different paragraph formatting must not be silently flattened by joining.
        prev_annotation = project.annotations.get(focus)
        if prev_annotation and prev_annotation.sizes:
            raise ValueError('前一段有逐字字号覆盖，请先清除该覆盖再合并')
        previous.extend(deepcopy(list(paragraph.findall(q('r')))))
        paragraph.getparent().remove(paragraph)
        project.annotations.pop(operation.id, None)
    elif operation.action == 'delete':
        parent = paragraph.getparent()
        if len(parent.findall(q('p'))) <= 1:
            raise ValueError('主体或单元格至少保留一个段落')
        parent.remove(paragraph)
        project.annotations.pop(operation.id, None)
        focus = package.ids[parent.find(q('p'))]
    project.content = snapshot(package)
    project.undo = [*project.undo[-49:], before]
    project.redo = []
    touch(project)
    return focus


def editable_view(source, project):
    package = package_for(source, project.content)
    view = project_document(package)
    for block in view['blocks']:
        block['text_editable'] = project.text_editing and text_editable(package.by_id[block['id']])
    return view


def export_edited(source, content, annotations):
    package = package_for(source, content)
    ids = [package.ids[p] for p in package.body.iter(q('p'))]
    positional = {f'p{i + 1}': annotations[identity] for i, identity in enumerate(ids) if identity in annotations}
    return export_docx(package.replace_document(), positional)
