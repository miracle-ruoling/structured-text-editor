import io
import zipfile

import pytest
from lxml import etree
from structured_editor.docx.package import DocxPackage
from structured_editor.docx.reader import project_document
from structured_editor.docx.writer import export_docx
from structured_editor.docx.xml import NS, PPR_ORDER, RPR_ORDER, own_runs, q, value
from structured_editor.domain.models import Annotation, FormatPatch


def test_reader_distinguishes_structure_and_classification(source):
    view = project_document(DocxPackage(source))
    assert len(view["blocks"]) == 22
    assert len([b for b in view["blocks"] if b["in_table"]]) == 9
    assert next(b for b in view["blocks"] if b["id"] == "p2")["role"] == "unclassified"
    assert next(b for b in view["blocks"] if b["id"] == "p4")["role"] == "heading"
    assert any(node["kind"] == "table" for node in view["layout"])


def test_no_format_changes_returns_identical_source(source):
    assert export_docx(source, {}) == source
    assert export_docx(source, {"p3": Annotation(role="quote", tags=["重点"])}) == source


def test_export_changes_only_selected_paragraph_and_preserves_package(rich_source):
    patch = FormatPatch(
        size_pt=14,
        font_east_asia="仿宋",
        font_latin="Arial",
        first_line_chars=2,
        line_spacing=1.5,
        space_before_pt=6,
        space_after_pt=8,
        alignment="both",
    )
    output = export_docx(rich_source, {"p3": Annotation(format=patch)})
    old, new = DocxPackage(rich_source), DocxPackage(output)
    for info in old.archive.infolist():
        if info.filename != "word/document.xml":
            assert new.archive.read(info.filename) == old.archive.read(info.filename)
    for identity in old.by_id:
        if identity != "p3":
            assert etree.tostring(new.by_id[identity]) == etree.tostring(old.by_id[identity])
    assert old.document.xpath("//w:t/text()", namespaces=NS) == new.document.xpath(
        "//w:t/text()", namespaces=NS
    )
    p = new.by_id["p3"]
    assert value(p, "w:pPr/w:ind", "firstLineChars") == "200"
    assert value(p, "w:pPr/w:ind", "left") == "100"
    assert value(p, "w:pPr/w:ind", "hanging") is None
    assert value(p, "w:pPr/w:ind", "hangingChars") is None
    assert value(p, "w:pPr/w:spacing", "line") == "360"
    assert value(p, "w:pPr/w:spacing", "lineRule") == "auto"
    assert value(p, "w:pPr/w:spacing", "before") == "120"
    assert value(p, "w:pPr/w:spacing", "after") == "160"
    assert value(p, "w:pPr/w:spacing", "beforeLines") is None
    for run in own_runs(p):
        assert value(run, "w:rPr/w:sz") == "28"
        assert value(run, "w:rPr/w:szCs") == "28"
        assert value(run, "w:rPr/w:rFonts", "eastAsia") == "仿宋"
        assert value(run, "w:rPr/w:rFonts", "asciiTheme") is None
    assert p.find("w:r/w:rPr/w:b", NS) is not None
    assert value(p, "w:r/w:rPr/w:vertAlign") == "superscript"
    assert etree.tostring(old.by_id["p3"].find("m:oMath", NS)) == etree.tostring(p.find("m:oMath", NS))


def test_inserted_properties_follow_schema_order(source):
    output = export_docx(
        source,
        {
            "p3": Annotation(
                format=FormatPatch(size_pt=16, first_line_chars=2, line_spacing=1.5, alignment="center")
            )
        },
    )
    p = DocxPackage(output).by_id["p3"]
    for node, order in [(p.find(q("pPr")), PPR_ORDER), (p.find("w:r/w:rPr", NS), RPR_ORDER)]:
        ranks = [order.index(etree.QName(child).localname) for child in node]
        assert ranks == sorted(ranks)


def test_revisions_and_textboxes_are_not_editable(source):
    package = DocxPackage(source)
    paragraph = package.by_id["p3"]
    revision = etree.SubElement(paragraph, q("ins"))
    etree.SubElement(etree.SubElement(revision, q("r")), q("t")).text = "修订内容"
    textbox = etree.SubElement(etree.SubElement(package.by_id["p5"], q("r")), q("txbxContent"))
    box_p = etree.SubElement(textbox, q("p"))
    etree.SubElement(etree.SubElement(box_p, q("r")), q("t")).text = "隐藏文本框"
    data = package.replace_document()
    view = project_document(DocxPackage(data))
    assert not next(b for b in view["blocks"] if b["id"] == "p3")["editable"]
    assert not any(b["text"] == "隐藏文本框" for b in view["blocks"])
    with pytest.raises(ValueError):
        export_docx(data, {"p3": Annotation(format=FormatPatch(size_pt=14))})
    output = DocxPackage(export_docx(data, {"p5": Annotation(format=FormatPatch(size_pt=14))}))
    assert output.document.find(".//w:txbxContent/w:p/w:r/w:rPr", NS) is None


def test_unknown_style_remains_unclassified_and_inherited_heading_is_recognized(source):
    package = DocxPackage(source)
    style = etree.SubElement(
        package.styles, q("style"), {q("styleId"): "CustomHeading", q("type"): "paragraph"}
    )
    etree.SubElement(style, q("basedOn"), {q("val"): "Heading1"})
    paragraph = package.by_id["p3"]
    paragraph.find("w:pPr/w:pStyle", NS).set(q("val"), "CustomHeading")
    view = project_document(package)
    assert next(b for b in view["blocks"] if b["id"] == "p3")["role"] == "heading"


def test_empty_paragraph_receives_font_default(source):
    package = DocxPackage(source)
    p = package.by_id["p3"]
    for child in list(p):
        p.remove(child)
    output = DocxPackage(
        export_docx(package.replace_document(), {"p3": Annotation(format=FormatPatch(size_pt=14))})
    )
    assert value(output.by_id["p3"], "w:pPr/w:rPr/w:sz") == "28"


def test_rejects_non_docx_and_dtd():
    with pytest.raises(ValueError):
        DocxPackage(b"not a file")
    archive = io.BytesIO()
    with zipfile.ZipFile(archive, "w") as z:
        z.writestr("[Content_Types].xml", "<Types/>")
        z.writestr(
            "word/document.xml", '<!DOCTYPE root [<!ENTITY e SYSTEM "file:///secrets">]><root>&e;</root>'
        )
    with pytest.raises(ValueError):
        DocxPackage(archive.getvalue())
