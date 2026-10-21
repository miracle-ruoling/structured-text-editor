"""Portable, one-shot role formatting. No selectors or source IDs in templates."""

import json
from collections import Counter
from copy import deepcopy
from typing import Literal

from pydantic import Field, ValidationError, field_validator, model_validator

from .models import ROLES, Annotation, FormatPatch, Model, RevisionRequest, Role, Selector
from .rules import FONT_KEYS
from .selectors import select

FONT_LABELS = {"font_east_asia": "中文字体", "font_latin": "西文字体", "size_pt": "字号", "bold": "粗体", "italic": "斜体"}


class TemplateEntry(Model):
    role: Role
    patch: FormatPatch

    @model_validator(mode="after")
    def not_empty(self):
        if not self.patch.values():
            raise ValueError("每个模板类别至少需要一项格式；不需要的类别请移除")
        return self


class FormatTemplate(Model):
    version: Literal[1] = 1
    name: str = Field(min_length=1, max_length=60)
    entries: list[TemplateEntry] = Field(min_length=1, max_length=9)

    @field_validator("name")
    @classmethod
    def clean_name(cls, value):
        if not value.strip():
            raise ValueError("请输入模板名称")
        return value.strip()

    @model_validator(mode="after")
    def unique_roles(self):
        if len({entry.role for entry in self.entries}) != len(self.entries):
            raise ValueError("模板中每个类别只能出现一次")
        return self


class StoredTemplate(FormatTemplate):
    id: str = Field(pattern=r"^[0-9a-f]{32}$")


class TemplateRequest(RevisionRequest):
    template: FormatTemplate
    # None explicitly means whole document; empty OR remains an empty scope.
    selector: Selector | None = None


class TemplateSave(RevisionRequest):
    template: FormatTemplate
    id: str | None = Field(default=None, pattern=r"^[0-9a-f]{32}$")


class TemplateIdentity(RevisionRequest):
    id: str = Field(pattern=r"^[0-9a-f]{32}$")


class TemplateLibrary(Model):
    version: Literal[1] = 1
    revision: int = 0
    items: list[StoredTemplate] = Field(default_factory=list, max_length=100)
    deleted: list[StoredTemplate] = Field(default_factory=list, max_length=20)

    @model_validator(mode="after")
    def unique_items(self):
        if len({x.name.casefold() for x in self.items}) != len(self.items):
            raise ValueError("模板名称不能重复")
        all_items = self.items + self.deleted
        if len({x.id for x in all_items}) != len(all_items):
            raise ValueError("模板 ID 不能重复")
        return self


def extract_patch(block: dict) -> tuple[dict, dict]:
    """Only copy representable, known values. Never collapse mixed inline text."""
    values, omitted = {}, {}
    for key in FormatPatch.model_fields:
        value = block["format"].get(key)
        if key in FONT_KEYS and block["runs"]:
            run_values = {run["format"].get(key) for run in block["runs"]}
            if len(run_values) != 1:
                omitted[key] = "段内文字格式混合"
                continue
            value = next(iter(run_values))
        if value is None:
            omitted[key] = "未解析或当前单位不支持提取"
            continue
        try:
            values.update(FormatPatch(**{key: value}).values())
        except ValidationError:
            omitted[key] = "超出当前支持的值或步进"
    return values, omitted


def extract_template(blocks: list[dict]) -> list[dict]:
    groups = {}
    for block in blocks:
        if not block["editable"]:
            continue
        patch, omitted = extract_patch(block)
        signature = json.dumps(patch, sort_keys=True, ensure_ascii=False)
        group = groups.setdefault(block["role"], {})
        candidate = group.setdefault(signature, {"patch": patch, "count": 0, "example": block["id"], "omitted": Counter()})
        candidate["count"] += 1
        candidate["omitted"].update(omitted.keys())
    result = []
    for role in ROLES:
        if role not in groups:
            continue
        candidates = sorted(groups[role].values(), key=lambda c: (-c["count"], int(c["example"][1:])))
        # Diagnostics count paragraphs, not how many differing values happen to occur.
        for candidate in candidates:
            candidate["omitted"] = dict(candidate["omitted"])
        top = candidates[0]["count"]
        tied = sum(c["count"] == top for c in candidates) > 1
        result.append({"role": role, "count": sum(c["count"] for c in candidates), "candidates": candidates,
                       "suggested": None if tied or not candidates[0]["patch"] else 0, "tied": tied})
    return result


def template_annotations(annotations: dict, blocks: list[dict], request: TemplateRequest):
    selected = set(select(blocks, request.selector or Selector()))
    entries = {entry.role: entry.patch.values() for entry in request.template.entries}
    result = deepcopy(annotations)
    ids, warnings = [], []
    counts = Counter()
    for block in blocks:
        patch = entries.get(block["role"])
        if block["id"] not in selected or not patch:
            continue
        ids.append(block["id"])
        counts[block["role"]] += 1
        annotation = result.setdefault(block["id"], Annotation())
        annotation.format = FormatPatch(**(annotation.format.values() | patch))
        if "size_pt" in patch:
            annotation.sizes = None
        mixed = set(block["mixed"]) & patch.keys() & FONT_KEYS
        if mixed:
            warnings.append(f"{block['id'].upper()} 的混合文字属性将统一：" + "、".join(FONT_LABELS[key] for key in sorted(mixed)))
    return result, ids, dict(counts), warnings
