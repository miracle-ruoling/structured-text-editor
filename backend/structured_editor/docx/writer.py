from ..domain.models import Annotation
from .package import DocxPackage
from .reader import is_editable
from .xml import ordered, own_runs, properties, q, run_text


def write_run(rpr, patch: dict):
    for key, word in (("bold", "b"), ("italic", "i")):
        if key in patch:
            ordered(rpr, word).set(q("val"), "1" if patch[key] else "0")
    if "size_pt" in patch:
        for name in ("sz", "szCs"):
            ordered(rpr, name).set(q("val"), str(round(patch["size_pt"] * 2)))
    if "font_east_asia" in patch or "font_latin" in patch:
        fonts = ordered(rpr, "rFonts")
        if "font_east_asia" in patch:
            fonts.set(q("eastAsia"), patch["font_east_asia"])
            fonts.attrib.pop(q("eastAsiaTheme"), None)
        if "font_latin" in patch:
            for name in ("ascii", "hAnsi", "cs"):
                fonts.set(q(name), patch["font_latin"])
            for name in ("asciiTheme", "hAnsiTheme", "cstheme", "csTheme"):
                fonts.attrib.pop(q(name), None)


def write_paragraph(paragraph, patch: dict):
    ppr = properties(paragraph, "pPr")
    for key, word in (
        ("page_break_before", "pageBreakBefore"),
        ("keep_next", "keepNext"),
        ("keep_lines", "keepLines"),
        ("widow_control", "widowControl"),
    ):
        if key in patch:
            ordered(ppr, word).set(q("val"), "1" if patch[key] else "0")
    if "first_line_chars" in patch:
        ind = ordered(ppr, "ind")
        for name in ("hanging", "hangingChars"):
            ind.attrib.pop(q(name), None)
        ind.set(q("firstLine"), "0")
        ind.set(q("firstLineChars"), str(round(patch["first_line_chars"] * 100)))
    if any(k in patch for k in ("line_spacing", "space_before_pt", "space_after_pt")):
        spacing = ordered(ppr, "spacing")
        if "line_spacing" in patch:
            spacing.set(q("line"), str(round(patch["line_spacing"] * 240)))
            spacing.set(q("lineRule"), "auto")
            # A document grid can otherwise override the requested multiple line spacing.
            ordered(ppr, "snapToGrid").set(q("val"), "0")
        for key, word in (("space_before_pt", "before"), ("space_after_pt", "after")):
            if key in patch:
                spacing.set(q(word), str(round(patch[key] * 20)))
                spacing.set(q(word + "Autospacing"), "0")
                spacing.attrib.pop(q(word + "Lines"), None)
    if "alignment" in patch:
        ordered(ppr, "jc").set(q("val"), patch["alignment"])
    if any(k in patch for k in ("size_pt", "font_east_asia", "font_latin", "bold", "italic")):
        write_run(ordered(ppr, "rPr"), patch)
        for run in own_runs(paragraph):
            write_run(properties(run, "rPr"), patch)


def export_docx(source: bytes, annotations: dict[str, Annotation]) -> bytes:
    selected = {key: a for key, a in annotations.items() if a.format.values() or a.sizes}
    if not selected:
        return source
    package = DocxPackage(source)
    for identity, annotation in selected.items():
        paragraph = package.by_id.get(identity)
        if paragraph is None or not is_editable(paragraph):
            raise ValueError("项目中的段落定位无效，请重新导入原文档。")
        patch = annotation.format.values()
        if patch:
            write_paragraph(paragraph, patch)
        if annotation.sizes:
            sizes = annotation.sizes
            if sizes.paragraph_pt is not None:
                write_run(ordered(properties(paragraph, "pPr"), "rPr"), {"size_pt": sizes.paragraph_pt})
            runs = {str(i): run for i, run in enumerate(own_runs(paragraph)) if run_text(run)}
            if not sizes.runs.keys() <= runs.keys():
                raise ValueError("逐文字字号的源 run 定位失效，请重新导入项目。")
            for index, size in sizes.runs.items():
                write_run(properties(runs[index], "rPr"), {"size_pt": size})
    return package.replace_document()
