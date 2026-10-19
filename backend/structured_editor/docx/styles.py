import re

from .xml import NS, own_runs, q, run_text, value


def read_properties(node, paragraph=False) -> dict:
    if node is None:
        return {}
    result = {}
    if paragraph:
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
    else:
        size = value(node, "w:sz")
        if size:
            result["size_pt"] = int(size) / 2
        fonts = node.find(q("rFonts"))
        if fonts is not None:
            for attr, field in (("eastAsia", "font_east_asia"), ("ascii", "font_latin")):
                if fonts.get(q(attr)):
                    result[field] = fonts.get(q(attr))
                elif fonts.get(q(attr + "Theme")):
                    result.pop(field, None)
                    result[field] = None
        for word, field in (("b", "bold"), ("i", "italic")):
            flag = node.find(q(word))
            if flag is not None:
                result[field] = flag.get(q("val"), "true") not in ("false", "0", "off")
        color = value(node, "w:color")
        if color and re.fullmatch(r"[A-Fa-f0-9]{6}", color):
            result["color"] = "#" + color
    return result


class StyleResolver:
    def __init__(self, root):
        self.root = root
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
        fmt, sources = {}, {}

        def merge(props, source, para=False):
            data = read_properties(props, para)
            # A new indentation / line mode replaces the other unit in the display projection.
            if "first_line_chars" in data:
                fmt.pop("first_line_pt", None)
            if "first_line_pt" in data:
                fmt.pop("first_line_chars", None)
            if "line_spacing" in data:
                fmt.pop("line_spacing_pt", None)
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
        for style in chain:
            name = value(style, "w:name") or style.get(q("styleId"))
            merge(style.find(q("rPr")), f"样式：{name}")
            merge(style.find(q("pPr")), f"样式：{name}", True)
        merge(ppr, "段落直接格式", True)
        # Paragraph-mark rPr does not override existing text runs. Use it only for empty paragraphs.
        runs = []
        for run in own_runs(paragraph):
            text = run_text(run)
            if not text:
                continue
            rpr = run.find(q("rPr"))
            run_format = dict(fmt)
            for char_style in self.chain(value(rpr, "w:rStyle")):
                run_format.update(read_properties(char_style.find(q("rPr"))))
            run_format.update(read_properties(rpr))
            runs.append({"text": text, "format": run_format})
        if not runs and ppr is not None:
            merge(ppr.find(q("rPr")), "段落标记格式")
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
                if resolved is not None:
                    fmt[key] = resolved
        role, reason = self.classify(ppr, style_id, style_name, chain)
        return fmt, sources, runs, mixed, style_id, style_name, role, reason

    def classify(self, ppr, style_id, style_name, chain):
        outline = value(ppr, "w:outlineLvl")
        if outline is None:
            outline = next(
                (v for s in reversed(chain) if (v := value(s, "w:pPr/w:outlineLvl")) is not None), None
            )
        if outline is not None and outline.isdigit() and 0 <= int(outline) <= 8:
            return "heading", f"大纲级别 {int(outline) + 1}"
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
        if value(ppr, "w:numPr/w:numId") is not None or any(
            value(s, "w:pPr/w:numPr/w:numId") is not None for s in chain
        ):
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
