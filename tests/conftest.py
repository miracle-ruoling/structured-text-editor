import io
import zipfile

import pytest
from fastapi.testclient import TestClient
from lxml import etree
from structured_editor.api import create_app
from structured_editor.docx.package import DocxPackage
from structured_editor.docx.sample import create_sample
from structured_editor.docx.xml import W, q


def pytest_configure(config):
    (config.rootpath / ".artifacts").mkdir(exist_ok=True)


@pytest.fixture
def source():
    return create_sample()


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(tmp_path / "projects")) as client:
        yield client


@pytest.fixture
def rich_source(source):
    package = DocxPackage(source)
    paragraph = package.by_id["p3"]
    ppr = paragraph.find(q("pPr"))
    etree.SubElement(ppr, q("ind"), {q("hanging"): "420", q("hangingChars"): "200", q("left"): "100"})
    etree.SubElement(
        ppr,
        q("spacing"),
        {q("line"): "240", q("lineRule"): "exact", q("beforeLines"): "100", q("afterLines"): "200"},
    )
    run = paragraph.find(q("r"))
    rpr = etree.Element(q("rPr"))
    run.insert(0, rpr)
    etree.SubElement(rpr, q("rFonts"), {q("asciiTheme"): "majorHAnsi", q("eastAsiaTheme"): "minorEastAsia"})
    etree.SubElement(rpr, q("b"))
    etree.SubElement(rpr, q("vertAlign"), {q("val"): "superscript"})
    link = etree.SubElement(paragraph, q("hyperlink"), {q("anchor"): "bookmark"})
    link_run = etree.SubElement(link, q("r"))
    etree.SubElement(link_run, q("t")).text = "链接文字"
    math = etree.SubElement(
        paragraph,
        "{http://schemas.openxmlformats.org/officeDocument/2006/math}oMath",
        nsmap={"m": "http://schemas.openxmlformats.org/officeDocument/2006/math"},
    )
    etree.SubElement(math, "{http://schemas.openxmlformats.org/officeDocument/2006/math}r")
    content = package.replace_document()
    result = io.BytesIO()
    with (
        zipfile.ZipFile(io.BytesIO(content)) as old,
        zipfile.ZipFile(result, "w", zipfile.ZIP_DEFLATED) as new,
    ):
        for info in old.infolist():
            new.writestr(info, old.read(info))
        new.writestr("word/media/image1.png", b"preserve-media-bytes")
        new.writestr(
            "word/header1.xml", f'<w:hdr xmlns:w="{W}"><w:p><w:r><w:t>页眉</w:t></w:r></w:p></w:hdr>'
        )
        new.writestr("customXml/item1.xml", b"<custom>preserve this metadata</custom>")
    return result.getvalue()
