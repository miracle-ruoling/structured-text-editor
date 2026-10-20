"""Verify the actual output package before delivery; no HTTP or project mutation."""

from copy import deepcopy

from lxml import etree

from .package import DocxPackage
from .xml import NS, own_runs, q


def content_structure(package, expected):
    """Ignore only format containers we write; retain document/table/object structure."""
    root = deepcopy(package.document)
    for index, paragraph in enumerate(root.find(q("body")).iter(q("p")), 1):
        if f"p{index}" not in expected:
            continue
        ppr = paragraph.find(q("pPr"))
        if ppr is not None:
            for word in (
                "pageBreakBefore",
                "keepNext",
                "keepLines",
                "widowControl",
                "ind",
                "spacing",
                "snapToGrid",
                "jc",
            ):
                for node in ppr.findall(q(word)):
                    ppr.remove(node)
        for container in [ppr, *own_runs(paragraph)]:
            if container is None:
                continue
            rpr = container.find(q("rPr"))
            if rpr is not None:
                for word in ("b", "i", "sz", "szCs", "rFonts"):
                    for node in rpr.findall(q(word)):
                        rpr.remove(node)
                if not len(rpr) and not rpr.attrib:
                    container.remove(rpr)
        if ppr is not None and not len(ppr) and not ppr.attrib:
            paragraph.remove(ppr)
    return etree.tostring(root)


def audit_export(source: bytes, output: bytes, expected: set[str]) -> dict:
    old, new = DocxPackage(source), DocxPackage(output)
    old_names, new_names = set(old.archive.namelist()), set(new.archive.namelist())
    if old_names != new_names or old.by_id.keys() != new.by_id.keys():
        raise ValueError("导出检查发现文件结构变化，已停止导出。")
    changed_parts = [
        name for name in old.archive.namelist() if old.archive.read(name) != new.archive.read(name)
    ]
    changed_ids = [
        identity
        for identity in old.by_id
        if etree.tostring(old.by_id[identity]) != etree.tostring(new.by_id[identity])
    ]
    text_query = "//w:t/text() | //w:instrText/text() | //w:delText/text() | //m:t/text()"
    text_preserved = old.document.xpath(text_query, namespaces=NS) == new.document.xpath(
        text_query, namespaces=NS
    )
    structure_preserved = content_structure(old, expected) == content_structure(new, expected)
    if (
        set(changed_parts) - {"word/document.xml"}
        or set(changed_ids) - expected
        or not text_preserved
        or not structure_preserved
    ):
        raise ValueError("导出检查发现非预期内容或范围变化，已停止导出，原文件未改。")
    return {
        "verified": True,
        "changed_parts": changed_parts,
        "preserved_parts": len(old_names) - len(changed_parts),
        "changed_ids": changed_ids,
        "text_preserved": text_preserved,
        "unselected_preserved": True,
        "structure_preserved": True,
    }
