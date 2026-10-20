"""Small generated compatibility corpus; no user documents are stored in Git."""

import io
import zipfile

from lxml import etree
from structured_editor.docx.package import DocxPackage
from structured_editor.docx.xml import W, parse, properties, q

REL = "http://schemas.openxmlformats.org/package/2006/relationships"


def replace_parts(source, parts):
    output = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(source)) as old, zipfile.ZipFile(output, "w") as new:
        for item in old.infolist():
            new.writestr(item, parts.get(item.filename, old.read(item)))
        for name, content in parts.items():
            if name not in old.namelist():
                new.writestr(name, content)
    return output.getvalue()


def compatibility_source(source):
    package = DocxPackage(source)
    p3 = package.by_id["p3"]
    # A non-text run before the second visible run exercises stable source indices.
    etree.SubElement(p3, q("r"))
    run = etree.SubElement(p3, q("r"))
    rpr = etree.SubElement(run, q("rPr"))
    etree.SubElement(rpr, q("sz"), {q("val"): "26"})
    etree.SubElement(rpr, q("i"))
    etree.SubElement(run, q("t")).text = "非标准十三磅"
    # Nested heading, a Word section ending after P7, and a heading inside a table.
    etree.SubElement(properties(package.by_id["p6"], "pPr"), q("outlineLvl"), {q("val"): "1"})
    section = etree.SubElement(properties(package.by_id["p7"], "pPr"), q("sectPr"))
    etree.SubElement(section, q("type"), {q("val"): "continuous"})
    etree.SubElement(properties(package.by_id["p10"], "pPr"), q("outlineLvl"), {q("val"): "0"})
    numpr = etree.SubElement(properties(package.by_id["p9"], "pPr"), q("numPr"))
    etree.SubElement(numpr, q("ilvl"), {q("val"): "0"})
    etree.SubElement(numpr, q("numId"), {q("val"): "7"})
    styles = package.styles
    fonts = styles.find(".//" + q("docDefaults") + "/" + q("rPrDefault") + "/" + q("rPr") + "/" + q("rFonts"))
    fonts.set(q("eastAsiaTheme"), "minorEastAsia")
    fonts.set(q("asciiTheme"), "minorHAnsi")
    defaults = styles.find(".//" + q("pPrDefault") + "/" + q("pPr"))
    etree.SubElement(defaults, q("widowControl"))
    for identity, parent in (("ToggleBase", "Normal"), ("ToggleChild", "ToggleBase")):
        style = etree.SubElement(styles, q("style"), {q("type"): "paragraph", q("styleId"): identity})
        etree.SubElement(style, q("name"), {q("val"): identity})
        etree.SubElement(style, q("basedOn"), {q("val"): parent})
        etree.SubElement(etree.SubElement(style, q("rPr")), q("b"))
    properties(package.by_id["p5"], "pPr").find(q("pStyle")).set(q("val"), "ToggleChild")
    relations = parse(package.archive.read("word/_rels/document.xml.rels"))
    for kind, target in (
        ("theme", "theme/custom.xml"),
        ("settings", "settings.xml"),
        ("numbering", "numbering.xml"),
    ):
        etree.SubElement(
            relations,
            "{" + REL + "}Relationship",
            Id="test-" + kind,
            Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/" + kind,
            Target=target,
        )
    theme = """<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:themeElements><a:fontScheme name="Tests">
      <a:majorFont><a:latin typeface="Theme Major"/><a:ea/><a:font script="Hans" typeface="主题标题"/></a:majorFont>
      <a:minorFont><a:latin typeface="Theme Latin"/><a:ea/><a:font script="Hans" typeface="主题宋体"/><a:font script="Hant" typeface="主題宋體"/><a:font script="Jpan" typeface="Theme Japan"/></a:minorFont>
    </a:fontScheme></a:themeElements></a:theme>""".encode()
    numbering = f'''<w:numbering xmlns:w="{W}"><w:abstractNum w:abstractNumId="2"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr><w:rPr><w:sz w:val="80"/></w:rPr></w:lvl></w:abstractNum><w:num w:numId="7"><w:abstractNumId w:val="2"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="4"/></w:lvlOverride></w:num></w:numbering>'''.encode()
    return replace_parts(
        package.replace_document(),
        {
            "word/styles.xml": etree.tostring(styles),
            "word/_rels/document.xml.rels": etree.tostring(relations),
            "word/theme/custom.xml": theme,
            "word/settings.xml": f'<w:settings xmlns:w="{W}"><w:themeFontLang w:eastAsia="zh-CN"/></w:settings>'.encode(),
            "word/numbering.xml": numbering,
        },
    )
