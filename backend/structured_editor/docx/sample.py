import io
import zipfile

from lxml import etree

from .xml import W, q

PROTECTED_TEXT = (
    "这是一段需要保留原格式的引文。它仍然属于正文，但有自己的例外：给它一个标签，就能让批量操作绕过它。"
)


def create_sample() -> bytes:
    root = etree.Element(q("document"), nsmap={"w": W})
    body = etree.SubElement(root, q("body"))

    def paragraph(parent, text, style="Normal"):
        p = etree.SubElement(parent, q("p"))
        props = etree.SubElement(p, q("pPr"))
        etree.SubElement(props, q("pStyle")).set(q("val"), style)
        r = etree.SubElement(p, q("r"))
        etree.SubElement(r, q("t")).text = text
        return p

    paragraph(body, "让文档，回到内容本身", "Title")
    paragraph(body, "一份关于结构、表达与秩序的写作实验", "Subtitle")
    paragraph(
        body,
        "好的排版始于清晰的结构。当每一段文字都有明确的身份，我们就能把注意力交还给内容，让格式成为一种有迹可循的规则。",
    )
    paragraph(body, "01  先识别，再改变", "Heading1")
    paragraph(
        body,
        "正文、标题和题注承担着不同的任务。我们可以为它们指定类别，也可以添加自由标签：同一类内容因此既能保持一致，又能保留必要的例外。",
    )
    paragraph(
        body,
        "试着在右侧设置首行缩进为 2 字符，然后预览。绿色标记的正文会发生变化，小标题、表格和带有保护标签的段落会留在原位。",
    )
    paragraph(body, PROTECTED_TEXT)
    paragraph(body, "02  让选择变得准确", "Heading1")
    paragraph(
        body,
        "选择器可以组合类别、标签和结构位置。下面表格中的文字同样属于正文，但因为它们位于表格内，可以单独排除，也可以单独设置格式。",
    )
    table = etree.SubElement(body, q("tbl"))
    props = etree.SubElement(table, q("tblPr"))
    borders = etree.SubElement(props, q("tblBorders"))
    for name in ("top", "left", "bottom", "right", "insideH", "insideV"):
        edge = etree.SubElement(borders, q(name))
        for key, val in (("val", "single"), ("sz", "4"), ("color", "D8DFDC")):
            edge.set(q(key), val)
    grid = etree.SubElement(table, q("tblGrid"))
    for _ in range(3):
        etree.SubElement(grid, q("gridCol")).set(q("w"), "2800")
    for row in (
        ("对象", "类别", "处理方式"),
        ("普通段落", "正文", "统一调整"),
        ("特殊段落", "正文 + 标签", "保留例外"),
    ):
        tr = etree.SubElement(table, q("tr"))
        for text in row:
            tc = etree.SubElement(tr, q("tc"))
            paragraph(tc, text)
    paragraph(body, "表 1  类别与标签，让格式拥有清晰的作用范围", "Caption")
    paragraph(body, "03  每次修改，都可以回头", "Heading1")
    paragraph(
        body,
        "预览让影响范围一目了然，撤销让尝试没有负担。确认之后导出 Word，将清晰的结构与恰当的格式带回你的日常工作。",
    )
    paragraph(body, 'role = "正文"  AND  context ≠ "表格"  AND  tag ≠ "保留原格式"', "SourceCode")
    section = etree.SubElement(body, q("sectPr"))
    size = etree.SubElement(section, q("pgSz"))
    size.set(q("w"), "11906")
    size.set(q("h"), "16838")
    margin = etree.SubElement(section, q("pgMar"))
    for key in ("top", "right", "bottom", "left"):
        margin.set(q(key), "1440")
    styles = f'''<w:styles xmlns:w="{W}">
      <w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="宋体"/><w:sz w:val="24"/></w:rPr></w:rPrDefault>
      <w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="360" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
      <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
      <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="0" w:after="160"/></w:pPr><w:rPr><w:rFonts w:eastAsia="黑体"/><w:b/><w:sz w:val="48"/></w:rPr></w:style>
      <w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:rPr><w:color w:val="74817E"/><w:sz w:val="20"/></w:rPr></w:style>
      <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="Heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="280" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:rFonts w:eastAsia="黑体"/><w:b/><w:sz w:val="30"/></w:rPr></w:style>
      <w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="Caption"/><w:basedOn w:val="Normal"/><w:rPr><w:color w:val="74817E"/><w:sz w:val="19"/></w:rPr></w:style>
      <w:style w:type="paragraph" w:styleId="SourceCode"><w:name w:val="Source Code"/><w:basedOn w:val="Normal"/><w:rPr><w:rFonts w:ascii="Consolas"/><w:sz w:val="20"/></w:rPr></w:style>
    </w:styles>'''.encode()
    relationships = b"""<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>"""
    document_rels = b"""<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>"""
    content_types = b"""<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>"""
    result = io.BytesIO()
    with zipfile.ZipFile(result, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, data in {
            "[Content_Types].xml": content_types,
            "_rels/.rels": relationships,
            "word/document.xml": etree.tostring(
                root, xml_declaration=True, encoding="UTF-8", standalone=True
            ),
            "word/styles.xml": styles,
            "word/_rels/document.xml.rels": document_rels,
        }.items():
            archive.writestr(name, data)
    return result.getvalue()
