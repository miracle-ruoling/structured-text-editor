import io
import posixpath
import zipfile

from lxml import etree

from .xml import parse, q

MAX_UPLOAD = 30 * 1024 * 1024
MAX_EXPANDED = 100 * 1024 * 1024


def open_zip(data: bytes) -> zipfile.ZipFile:
    if len(data) > MAX_UPLOAD:
        raise ValueError("文件过大，当前支持最大 30 MB 的文件。")
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
        items = archive.infolist()
        if len(items) > 5000 or sum(item.file_size for item in items) > MAX_EXPANDED:
            raise ValueError("解压后的文件过大，当前无法处理。")
        if len({item.filename for item in items}) != len(items):
            raise ValueError("文件包含重复的 ZIP 项，无法可靠定位内容。")
        if any(item.flag_bits & 1 for item in items):
            raise ValueError("不支持加密的文件。")
        return archive
    except (zipfile.BadZipFile, OSError) as exc:
        raise ValueError("无法读取文件，请选择有效的 DOCX 或文序项目文件。") from exc


class DocxPackage:
    def __init__(self, data: bytes):
        self.data = data
        self.archive = open_zip(data)
        names = self.archive.namelist()
        if "word/document.xml" not in names or "[Content_Types].xml" not in names:
            raise ValueError("这不是可识别的 Word DOCX 文件。")
        if any("vbaproject" in name.lower() for name in names):
            raise ValueError("当前不支持带宏的 Word 文档。")
        try:
            self.document = parse(self.archive.read("word/document.xml"))
            self.styles = parse(self.archive.read("word/styles.xml")) if "word/styles.xml" in names else None
            self.theme = self.related_xml("theme")
            self.settings = self.related_xml("settings")
            self.numbering = self.related_xml("numbering")
        except (etree.XMLSyntaxError, zipfile.BadZipFile) as exc:
            raise ValueError("Word 文件的 XML 内容损坏，无法读取。") from exc
        self.body = self.document.find(q("body"))
        if self.document.tag != q("document") or self.body is None:
            raise ValueError("当前仅支持常规 DOCX（Transitional），不支持 Strict OOXML。")
        self.paragraphs = list(self.body.iter(q("p")))
        if len(self.paragraphs) > 20000:
            raise ValueError("当前最多支持 20,000 个段落。")
        self.by_id = {f"p{index + 1}": paragraph for index, paragraph in enumerate(self.paragraphs)}
        self.ids = {paragraph: identity for identity, paragraph in self.by_id.items()}

    def related_xml(self, kind: str):
        path = "word/_rels/document.xml.rels"
        if path not in self.archive.namelist():
            return None
        relations = parse(self.archive.read(path))
        for relation in relations:
            if relation.get("Type", "").endswith("/" + kind) and relation.get("TargetMode") != "External":
                target = relation.get("Target", "")
                if not target or ":" in target or "\\" in target:
                    continue
                path = posixpath.normpath(target.lstrip("/") if target.startswith("/") else "word/" + target)
                if path.startswith("../") or path not in self.archive.namelist():
                    continue
                return parse(self.archive.read(path))
        return None

    def replace_document(self) -> bytes:
        xml = etree.tostring(self.document, encoding="UTF-8", xml_declaration=True, standalone=True)
        output = io.BytesIO()
        with zipfile.ZipFile(output, "w") as target:
            target.comment = self.archive.comment
            for item in self.archive.infolist():
                target.writestr(
                    item, xml if item.filename == "word/document.xml" else self.archive.read(item)
                )
        return output.getvalue()
