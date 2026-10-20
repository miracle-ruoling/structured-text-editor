import re

from .inheritance import Numbering, ThemeFonts
from .xml import NS, own_runs, q, run_text, value


def read_properties(node, paragraph=False) -> dict:
    if node is None:
        return {}
    result = {}
    if paragraph:
        for word, field in (
            ("pageBreakBefore", "page_break_before"),
            ("keepNext", "keep_next"),
            ("keepLines", "keep_lines"),
            ("widowControl", "widow_control"),
        ):
            flag = node.find(q(word))
            if flag is not None:
                result[field] = flag.get(q("val"), "true") not in ("false", "0", "off")
        alignment = value(node, "w:jc")
        if alignment:
            result["alignment"] = alignment
        ind = node.find(q("ind"))
        if ind is not None:
            for side in ("left", "right"):
                if ind.get(q(side + "Chars")) is not None:
                    result[f"{side}_indent_chars"] = int(ind.get(q(side + "Chars"))) / 100
                elif ind.get(q(side)) is not None:
                    result[f"{side}_indent_pt"] = int(ind.get(q(side))) / 20
            if ind.get(q("firstLineChars")) is not None:
                result["first_line_chars"] = int(ind.get(q("firstLineChars"))) / 100
            elif ind.get(q("hangingChars")) is not None:
                result["first_line_chars"] = -int(ind.get(q("hangingChars"))) / 100
            elif ind.get(q("firstLine")) is not None:
                result["first_line_pt"] = int(ind.get(q("firstLine"))) / 20
            elif ind.get(q("hanging")) is not None:
                result["first_line_pt"] = -int(ind.get(q("hanging"))) / 20
        spacing = node.find(q("spacing"))
        if spacing is not None:
            for word, field in (("before", "space_before_pt"), ("after", "space_after_pt")):
                if spacing.get(q(word)) is not None:
                    result[field] = int(spacing.get(q(word))) / 20
            if spacing.get(q("line")) is not None:
                if spacing.get(q("lineRule"), "auto") == "auto":
                    result["line_spacing"] = int(spacing.get(q("line"))) / 240
                else:
                    result["line_spacing_pt"] = int(spacing.get(q("line"))) / 20
                    result["line_spacing_rule"] = spacing.get(q("lineRule"))
    else:
        size = value(node, "w:sz")
        if size:
            result["size_pt"] = int(size) / 2
        fonts = node.find(q("rFonts"))
        if fonts is not None:
            for attr, field in (("eastAsia", "font_east_asia"), ("ascii", "font_latin")):
                theme = fonts.get(q(attr + "Theme"))
                if attr == "ascii" and not theme and not fonts.get(q(attr)):
                    theme = fonts.get(q("hAnsiTheme"))
                direct = fonts.get(q(attr)) or (fonts.get(q("hAnsi")) if attr == "ascii" else None)
                if theme or direct:
                    result[field] = None if theme else direct
                    result["_" + field + "_theme"] = theme
        language = value(node, "w:lang", "eastAsia")
        if language:
            result["_east_asia_language"] = language
        for word, field in (("b", "bold"), ("i", "italic")):
            flag = node.find(q(word))
            if flag is not None:
                result[field] = flag.get(q("val"), "true") not in ("false", "0", "off")
        color = value(node, "w:color")
        if color and re.fullmatch(r"[A-Fa-f0-9]{6}", color):
            result["color"] = "#" + color
    return result


class StyleResolver:
    def __init__(self, root, theme=None, settings=None, numbering=None):
        self.root = root
        language = value(settings, "w:themeFontLang", "eastAsia") or "zh-CN"
        self.theme = ThemeFonts(theme, language)
        self.numbering = Numbering(numbering)
        self.styles = {} if root is None else {s.get(q("styleId")): s for s in root.findall(q("style"))}
        self.default_id = next(
            (
                key
                for key, s in self.styles.items()
                if s.get(q("default")) == "1" and s.get(q("type")) == "paragraph"
            ),
            "Normal",
        )

    def chain(self, identity):
        chain, seen = [], set()
        while identity in self.styles and identity not in seen:
            seen.add(identity)
            style = self.styles[identity]
            chain.append(style)
            identity = value(style, "w:basedOn")
        return list(reversed(chain))

    def paragraph(self, paragraph):
        ppr = paragraph.find(q("pPr"))
        style_id = value(ppr, "w:pStyle") or self.default_id
        chain = self.chain(style_id)
        style_name = value(self.styles.get(style_id), "w:name") or style_id
        fmt, sources = {"bold": False, "italic": False}, {"bold": "默认关闭", "italic": "默认关闭"}

        def merge(props, source, para=False, toggle=False):
            data = read_properties(props, para)
            if toggle:
                toggle_style(data, fmt)
            # A new indentation / line mode replaces the other unit in the display projection.
            if "first_line_chars" in data:
                fmt.pop("first_line_pt", None)
            if "first_line_pt" in data:
                fmt.pop("first_line_chars", None)
            if "line_spacing" in data:
                fmt.pop("line_spacing_pt", None)
                fmt.pop("line_spacing_rule", None)
            if "line_spacing_pt" in data:
                fmt.pop("line_spacing", None)
            for side in ("left", "right"):
                if f"{side}_indent_chars" in data:
                    fmt.pop(f"{side}_indent_pt", None)
                if f"{side}_indent_pt" in data:
                    fmt.pop(f"{side}_indent_chars", None)
            fmt.update(data)
            sources.update({key: source for key in data})

        if self.root is not None:
            merge(self.root.find("w:docDefaults/w:rPrDefault/w:rPr", NS), "文档默认值")
            merge(self.root.find("w:docDefaults/w:pPrDefault/w:pPr", NS), "文档默认值", True)
        numbering, numbering_props = self.numbering.resolve([s.find(q("pPr")) for s in chain] + [ppr])
        merge(numbering_props, "编号级别段落格式", True)
        for style in chain:
            name = value(style, "w:name") or style.get(q("styleId"))
            merge(style.find(q("rPr")), f"样式：{name}", toggle=True)
            merge(style.find(q("pPr")), f"样式：{name}", True)
        merge(ppr, "段落直接格式", True)
        # Paragraph-mark rPr does not override existing text runs. Use it only for empty paragraphs.
        runs = []
        for index, run in enumerate(own_runs(paragraph)):
            text = run_text(run)
            if not text:
                continue
            rpr = run.find(q("rPr"))
            run_format = dict(fmt)
            for char_style in self.chain(value(rpr, "w:rStyle")):
                data = read_properties(char_style.find(q("rPr")))
                toggle_style(data, run_format)
                run_format.update(data)
            run_format.update(read_properties(rpr))
            self.theme.apply(run_format)
            runs.append({"index": index, "text": text, "format": run_format})
        if not runs and ppr is not None:
            merge(ppr.find(q("rPr")), "段落标记格式")
        paragraph_size = read_properties(ppr.find(q("rPr")) if ppr is not None else None).get(
            "size_pt", fmt.get("size_pt")
        )
        self.theme.apply(fmt, sources)
        mixed = []
        for key in ("font_east_asia", "font_latin", "size_pt", "bold", "italic", "color"):
            values = {r["format"].get(key) for r in runs}
            if len(values) > 1:
                fmt[key] = None
                mixed.append(key)
                sources[key] = "混合行内格式"
            elif runs and len(values) == 1:
                resolved = next(iter(values))
                if resolved != fmt.get(key):
                    sources[key] = "文字直接格式 / 字符样式"
                if resolved is not None or key in fmt:
                    fmt[key] = resolved
        outline = self.outline(ppr, chain)
        if outline is None:
            for raw in [style_id, style_name]:
                match = re.fullmatch(r"(?:heading|标题)\s*([1-9])", raw, re.IGNORECASE)
                if match:
                    outline = int(match[1]) - 1
                    break
        role, reason = self.classify(ppr, style_id, style_name, chain)
        for key in list(sources):
            if key not in fmt:
                sources.pop(key)
        metadata = {"paragraph_size_pt": paragraph_size, "outline_level": outline, "numbering": numbering}
        return fmt, sources, runs, mixed, style_id, style_name, role, reason, metadata

    def outline(self, ppr, chain):
        outline = value(ppr, "w:outlineLvl")
        if outline is None:
            outline = next(
                (v for s in reversed(chain) if (v := value(s, "w:pPr/w:outlineLvl")) is not None), None
            )
        return int(outline) if outline is not None and outline.isdigit() and 0 <= int(outline) <= 8 else None

    def classify(self, ppr, style_id, style_name, chain):
        outline = self.outline(ppr, chain)
        if outline is not None:
            return "heading", f"大纲级别 {outline + 1}"
        names = [style_id, style_name] + [value(s, "w:name") or "" for s in reversed(chain)]
        for raw in names:
            name = re.sub(r"[\s_-]+", "", raw).casefold()
            if re.fullmatch(r"(?:heading|标题)[1-9]", name):
                return "heading", f"样式：{raw}"
            mapping = {
                "title": "title",
                "标题": "title",
                "caption": "caption",
                "题注": "caption",
                "quote": "quote",
                "intensequote": "quote",
                "引用": "quote",
                "sourcecode": "code",
                "代码": "code",
                "bibliography": "reference",
                "参考文献": "reference",
                "listparagraph": "list",
                "compactlist": "list",
                "列表段落": "list",
            }
            if name in mapping:
                return mapping[name], f"样式：{raw}"
        numbering, _ = self.numbering.resolve([s.find(q("pPr")) for s in chain] + [ppr])
        if numbering is not None:
            return "list", "包含列表编号属性"
        if re.sub(r"\s+", "", style_name).casefold() in (
            "normal",
            "正文",
            "bodytext",
            "firstparagraph",
            "compact",
        ) or style_id in ("Normal", "BodyText", "FirstParagraph", "Compact"):
            return "body", f"样式：{style_name}"
        return "unclassified", f"待确认的样式：{style_name}"


def toggle_style(data, inherited):
    for field in ("bold", "italic"):
        if field in data:
            if data[field]:
                data[field] = not inherited.get(field, False)
            else:
                data.pop(field)
