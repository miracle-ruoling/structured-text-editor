"""Read package-local theme and numbering definitions without altering them."""

from .xml import q, value

A = "{http://schemas.openxmlformats.org/drawingml/2006/main}"


class ThemeFonts:
    def __init__(self, theme=None, language="zh-CN"):
        self.language = language
        self.groups = {}
        if theme is not None:
            for group in ("major", "minor"):
                self.groups[group] = theme.find(f".//{A}{group}Font")

    def resolve(self, reference, language=None):
        if not reference:
            return None
        group = (
            "major" if reference.startswith("major") else "minor" if reference.startswith("minor") else None
        )
        node = self.groups.get(group)
        if node is None:
            return None
        if reference.endswith(("Ascii", "HAnsi")):
            latin = node.find(A + "latin")
            return latin.get("typeface") or None if latin is not None else None
        if not reference.endswith("EastAsia"):
            return None
        east = node.find(A + "ea")
        if east is not None and east.get("typeface"):
            return east.get("typeface")
        language = (language or self.language).lower()
        script = (
            "Hant"
            if language in ("zh-tw", "zh-hk", "zh-mo")
            else "Hans"
            if language.startswith("zh")
            else "Jpan"
            if language.startswith("ja")
            else "Hang"
            if language.startswith("ko")
            else None
        )
        if script:
            font = next((font for font in node.findall(A + "font") if font.get("script") == script), None)
            return font.get("typeface") or None if font is not None else None
        return None

    def apply(self, fmt, sources=None):
        language = fmt.pop("_east_asia_language", None)
        for field in ("font_east_asia", "font_latin"):
            ref = fmt.pop("_" + field + "_theme", None)
            if ref:
                fmt[field] = self.resolve(ref, language)
                if sources is not None:
                    sources[field] = (
                        sources.get(field, "原文档")
                        + f" · 主题 {ref}"
                        + ("（未解析）" if fmt[field] is None else "")
                    )
        if sources is not None:
            for key in list(sources):
                if key.startswith("_"):
                    sources.pop(key)


class Numbering:
    def __init__(self, root=None):
        self.abstracts = (
            {} if root is None else {n.get(q("abstractNumId")): n for n in root.findall(q("abstractNum"))}
        )
        self.instances = {} if root is None else {n.get(q("numId")): n for n in root.findall(q("num"))}

    def resolve(self, paragraph_properties):
        num_id, level = None, "0"
        for props in paragraph_properties:
            candidate = value(props, "w:numPr/w:numId")
            if candidate is not None:
                num_id = candidate
            candidate = value(props, "w:numPr/w:ilvl")
            if candidate is not None:
                level = candidate
        if num_id in (None, "0"):
            return None, None
        instance = self.instances.get(num_id)
        abstract = self.abstracts.get(value(instance, "w:abstractNumId"))
        override = (
            next((n for n in instance.findall(q("lvlOverride")) if n.get(q("ilvl")) == level), None)
            if instance is not None
            else None
        )
        lvl = override.find(q("lvl")) if override is not None else None
        if lvl is None and abstract is not None:
            lvl = next((n for n in abstract.findall(q("lvl")) if n.get(q("ilvl")) == level), None)
        info = {
            "num_id": num_id,
            "level": int(level) if level.isdigit() else 0,
            "format": value(lvl, "w:numFmt"),
            "text": value(lvl, "w:lvlText"),
            "start": value(override, "w:startOverride") or value(lvl, "w:start") or "1",
            "resolved": lvl is not None,
        }
        return info, lvl.find(q("pPr")) if lvl is not None else None
