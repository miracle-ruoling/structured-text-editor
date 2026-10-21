"""Generate a new package from native content; never modify a source package."""

import io
import zipfile

from lxml import etree

from ..domain.native import NativeContent
from .xml import W, q


def export_native(content: NativeContent) -> bytes:
    document = etree.Element(q("document"), nsmap={"w": W})
    body = etree.SubElement(document, q("body"))
    for block in content.blocks:
        paragraph = etree.SubElement(body, q("p"))
        if block.kind == "heading":
            props = etree.SubElement(paragraph, q("pPr"))
            etree.SubElement(props, q("pStyle"), {q("val"): f"Heading{block.level}"})
        run = etree.SubElement(paragraph, q("r"))
        # Preserve soft newlines and tabs explicitly in OOXML.
        text = block.text.replace("\r\n", "\n").replace("\r", "\n")
        for index, line in enumerate(text.split("\n")):
            if index:
                etree.SubElement(run, q("br"))
            for tab_index, segment in enumerate(line.split("\t")):
                if tab_index:
                    etree.SubElement(run, q("tab"))
                node = etree.SubElement(run, q("t"), {"{http://www.w3.org/XML/1998/namespace}space": "preserve"})
                node.text = segment
    section = etree.SubElement(body, q("sectPr"))
    etree.SubElement(section, q("pgSz"), {q("w"): "11906", q("h"): "16838"})
    etree.SubElement(section, q("pgMar"), {q(k): "1440" for k in ("top", "right", "bottom", "left")})

    styles = etree.Element(q("styles"), nsmap={"w": W})
    defaults = etree.SubElement(styles, q("docDefaults"))
    rpr = etree.SubElement(etree.SubElement(defaults, q("rPrDefault")), q("rPr"))
    etree.SubElement(rpr, q("rFonts"), {q("ascii"): "Calibri", q("hAnsi"): "Calibri", q("eastAsia"): "宋体"})
    etree.SubElement(rpr, q("sz"), {q("val"): "24"})
    etree.SubElement(rpr, q("szCs"), {q("val"): "24"})
    normal = etree.SubElement(styles, q("style"), {q("type"): "paragraph", q("default"): "1", q("styleId"): "Normal"})
    etree.SubElement(normal, q("name"), {q("val"): "Normal"})
    for level, size in ((1, 36), (2, 30), (3, 26)):
        style = etree.SubElement(styles, q("style"), {q("type"): "paragraph", q("styleId"): f"Heading{level}"})
        etree.SubElement(style, q("name"), {q("val"): f"heading {level}"})
        etree.SubElement(style, q("basedOn"), {q("val"): "Normal"})
        etree.SubElement(style, q("next"), {q("val"): "Normal"})
        props = etree.SubElement(style, q("pPr"))
        etree.SubElement(props, q("keepNext"))
        etree.SubElement(props, q("outlineLvl"), {q("val"): str(level - 1)})
        props = etree.SubElement(style, q("rPr"))
        etree.SubElement(props, q("b"))
        etree.SubElement(props, q("sz"), {q("val"): str(size)})
        etree.SubElement(props, q("szCs"), {q("val"): str(size)})

    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", '''<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>''')
        archive.writestr("_rels/.rels", '''<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>''')
        archive.writestr("word/_rels/document.xml.rels", '''<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>''')
        for name, root in (("document", document), ("styles", styles)):
            archive.writestr(f"word/{name}.xml", etree.tostring(root, xml_declaration=True, encoding="UTF-8", standalone=True))
    return output.getvalue()
