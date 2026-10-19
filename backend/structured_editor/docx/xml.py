from lxml import etree

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
M = "http://schemas.openxmlformats.org/officeDocument/2006/math"
NS = {"w": W, "m": M}

PPR_ORDER = (
    "pStyle keepNext keepLines pageBreakBefore framePr widowControl numPr suppressLineNumbers "
    "pBdr shd tabs suppressAutoHyphens kinsoku wordWrap overflowPunct topLinePunct autoSpaceDE "
    "autoSpaceDN bidi adjustRightInd snapToGrid spacing ind contextualSpacing mirrorIndents "
    "suppressOverlap jc textDirection textAlignment textboxTightWrap outlineLvl divId cnfStyle "
    "rPr sectPr pPrChange"
).split()
RPR_ORDER = (
    "rStyle rFonts b bCs i iCs caps smallCaps strike dstrike outline shadow emboss imprint "
    "noProof snapToGrid vanish webHidden color spacing w kern position sz szCs highlight u "
    "effect bdr shd fitText vertAlign rtl cs em lang eastAsianLayout specVanish oMath rPrChange"
).split()


def q(name: str) -> str:
    return f"{{{W}}}{name}"


def parse(data: bytes):
    if b"<!DOCTYPE" in data.upper():
        raise ValueError("不支持包含 DTD 的 XML 文件")
    return etree.fromstring(
        data, etree.XMLParser(resolve_entities=False, no_network=True, remove_blank_text=False)
    )


def value(parent, path: str, attr: str = "val") -> str | None:
    node = parent.find(path, NS) if parent is not None else None
    return node.get(q(attr)) if node is not None else None


def ordered(parent, name: str):
    existing = parent.find(q(name))
    if existing is not None:
        return existing
    child = etree.Element(q(name))
    order = PPR_ORDER if parent.tag == q("pPr") else RPR_ORDER
    rank = order.index(name) if name in order else len(order)
    for index, sibling in enumerate(parent):
        local = etree.QName(sibling).localname
        if local in order and order.index(local) > rank:
            parent.insert(index, child)
            return child
    parent.append(child)
    return child


def properties(parent, name: str):
    existing = parent.find(q(name))
    if existing is None:
        existing = etree.Element(q(name))
        parent.insert(0, existing)
    return existing


def own_runs(paragraph):
    for run in paragraph.iter(q("r")):
        nearest = next((a for a in run.iterancestors() if a.tag == q("p")), None)
        if nearest is paragraph:
            yield run


def run_text(run):
    parts = []
    for child in run:
        if child.tag == q("t"):
            parts.append(child.text or "")
        elif child.tag == q("tab"):
            parts.append("\t")
        elif child.tag in (q("br"), q("cr")):
            parts.append("\n")
    return "".join(parts)
