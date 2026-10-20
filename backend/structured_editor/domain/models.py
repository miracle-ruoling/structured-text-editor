from __future__ import annotations

import re
from copy import deepcopy
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .expressions import parse_expression, references

Role = Literal["body", "title", "heading", "caption", "quote", "code", "list", "reference", "unclassified"]
ROLES = {
    "body": "正文",
    "title": "文档标题",
    "heading": "小标题",
    "caption": "图表题注",
    "quote": "引用",
    "code": "代码",
    "list": "列表",
    "reference": "参考文献",
    "unclassified": "未分类",
}


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class FormatPatch(Model):
    font_east_asia: str | None = Field(default=None, max_length=100)
    font_latin: str | None = Field(default=None, max_length=100)
    size_pt: float | None = Field(default=None, ge=1, le=200, multiple_of=0.5)
    first_line_chars: float | None = Field(default=None, ge=0, le=20, multiple_of=0.01)
    line_spacing: float | None = Field(default=None, ge=0.5, le=5, multiple_of=0.05)
    space_before_pt: float | None = Field(default=None, ge=0, le=200, multiple_of=0.05)
    space_after_pt: float | None = Field(default=None, ge=0, le=200, multiple_of=0.05)
    alignment: Literal["left", "center", "right", "both"] | None = None

    @field_validator("font_east_asia", "font_latin")
    @classmethod
    def clean_font(cls, value: str | None) -> str | None:
        if value is not None:
            value = value.strip()
            if not value:
                raise ValueError("字体名称不能为空")
        return value

    def values(self) -> dict:
        return self.model_dump(exclude_none=True)


class Condition(Model):
    key: str | None = Field(default=None, pattern=r"^[A-Z][A-Z0-9_]{0,15}$")
    field: Literal["role", "tag", "context", "text", "ids"]
    op: Literal["is", "is_not", "contains", "not_contains"] = "is"
    value: str = Field(default="", max_length=200)
    ids: list[str] | None = Field(default=None, max_length=20000)

    @model_validator(mode="after")
    def valid_condition(self):
        if self.field == "ids":
            if self.value or not self.ids or any(not re.fullmatch(r"p[1-9][0-9]*", i) for i in self.ids):
                raise ValueError("框选条件需要非空的有效段落 ID 集合")
            self.ids = list(dict.fromkeys(self.ids))
        elif self.ids is not None:
            raise ValueError("只有框选条件可以指定段落 ID")
        elif not self.value.strip():
            raise ValueError("请补全空白条件")
        if self.field == "role" and self.value not in ROLES:
            raise ValueError("未知类别")
        if self.field == "context" and self.value not in ("table", "outside_table"):
            raise ValueError("未知结构位置")
        if self.field != "text" and self.op not in ("is", "is_not"):
            raise ValueError("这个字段仅支持是/不是")
        return self


class Selector(Model):
    mode: Literal["all", "any", "expression"] = "all"
    conditions: list[Condition | Selector] = Field(default_factory=list, max_length=30)
    expression: str = Field(default="", max_length=2000)

    @model_validator(mode="after")
    def limit_tree(self):
        keys = [c.key for c in self.conditions if isinstance(c, Condition) and c.key]
        if len(keys) != len(set(keys)):
            raise ValueError("条件代号不能重复")
        if self.mode == "expression":
            if any(not isinstance(c, Condition) or not c.key for c in self.conditions):
                raise ValueError("高级表达式的每个条件都需要独立代号")
            missing = references(parse_expression(self.expression)) - set(keys)
            if missing:
                raise ValueError("表达式引用了不存在的条件：" + "、".join("$" + k for k in sorted(missing)))
        elif self.expression:
            raise ValueError("简单模式不能携带高级表达式")

        def count(group, depth=0):
            if depth > 5:
                raise ValueError("筛选分组最多嵌套 5 层")
            return 1 + sum(
                count(item, depth + 1) if isinstance(item, Selector) else 1 for item in group.conditions
            )

        if count(self) > 100:
            raise ValueError("筛选条件过多")
        return self


class Annotation(Model):
    role: Role | None = None
    tags: list[str] = Field(default_factory=list, max_length=30)
    format: FormatPatch = Field(default_factory=FormatPatch)

    @field_validator("tags")
    @classmethod
    def clean_tags(cls, tags):
        result = list(dict.fromkeys(tag.strip() for tag in tags if tag.strip()))
        if any(len(tag) > 40 for tag in result):
            raise ValueError("单个标签最多 40 个字符")
        return result


class SavedSelector(Model):
    id: str = Field(pattern=r"^[0-9a-f]{32}$")
    name: str = Field(min_length=1, max_length=60)
    selector: Selector

    @field_validator("name")
    @classmethod
    def clean_name(cls, value):
        if not value.strip():
            raise ValueError("请输入筛选名称")
        return value.strip()

    @field_validator("selector")
    @classmethod
    def editable_condition_list(cls, value):
        if any(isinstance(item, Selector) for item in value.conditions):
            raise ValueError("保存筛选时请用高级表达式表示嵌套关系")
        return value


class FormatRule(SavedSelector):
    patch: FormatPatch
    enabled: bool = True

    @model_validator(mode="after")
    def has_format(self):
        if not self.patch.values():
            raise ValueError("规则需要至少一个格式属性")
        return self


class Snapshot(Model):
    label: str
    annotations: dict[str, Annotation]
    saved_selectors: list[SavedSelector] = Field(default_factory=list, max_length=50)
    rules: list[FormatRule] = Field(default_factory=list, max_length=50)


class Project(Model):
    version: Literal[3] = 3
    id: str
    name: str
    source_sha256: str
    revision: int = 0
    annotations: dict[str, Annotation] = Field(default_factory=dict)
    saved_selectors: list[SavedSelector] = Field(default_factory=list, max_length=50)
    rules: list[FormatRule] = Field(default_factory=list, max_length=50)
    undo: list[Snapshot] = Field(default_factory=list, max_length=50)
    redo: list[Snapshot] = Field(default_factory=list, max_length=50)
    updated_at: str = ""

    @model_validator(mode="before")
    @classmethod
    def migrate_legacy(cls, value):
        if isinstance(value, dict) and value.get("version", 1) in (1, 2):
            value = deepcopy(value)
            value["version"] = 3
        return value

    @model_validator(mode="after")
    def unique_selections(self):
        for items in [self.saved_selectors, *[s.saved_selectors for s in self.undo + self.redo]]:
            if len({s.id for s in items}) != len(items) or len({s.name.casefold() for s in items}) != len(
                items
            ):
                raise ValueError("已保存筛选的名称和 ID 不能重复")
        for items in [self.rules, *[s.rules for s in self.undo + self.redo]]:
            if len({r.id for r in items}) != len(items) or len({r.name.casefold() for r in items}) != len(
                items
            ):
                raise ValueError("规则的名称和 ID 不能重复")
        return self


class FormatRequest(Model):
    revision: int
    selector: Selector
    patch: FormatPatch

    @model_validator(mode="after")
    def not_empty(self):
        if not self.patch.values():
            raise ValueError("请至少设置一个格式属性")
        return self


class AnnotationRequest(Model):
    revision: int
    ids: list[str] = Field(min_length=1, max_length=20000)
    role: Role | None = None
    reset_role: bool = False
    tags: list[str] | None = Field(default=None, max_length=30)

    @field_validator("tags")
    @classmethod
    def clean_tags(cls, value):
        return None if value is None else Annotation(tags=value).tags

    @model_validator(mode="after")
    def valid_role_change(self):
        if self.reset_role and self.role is not None:
            raise ValueError("恢复自动识别不能同时指定类别")
        return self


class RevisionRequest(Model):
    revision: int


class SaveSelectorRequest(RevisionRequest):
    name: str = Field(min_length=1, max_length=60)
    selector: Selector


class DeleteSelectorRequest(RevisionRequest):
    id: str = Field(pattern=r"^[0-9a-f]{32}$")


class RuleRequest(RevisionRequest):
    action: Literal["save", "delete", "toggle", "move"]
    rule: FormatRule | None = None
    id: str | None = Field(default=None, pattern=r"^[0-9a-f]{32}$")
    enabled: bool | None = None
    position: int | None = Field(default=None, ge=0, le=49)

    @model_validator(mode="after")
    def valid_action(self):
        required = {
            "save": {"rule"},
            "delete": {"id"},
            "toggle": {"id", "enabled"},
            "move": {"id", "position"},
        }
        present = {k for k in ("rule", "id", "enabled", "position") if getattr(self, k) is not None}
        if present != required[self.action]:
            raise ValueError("规则操作参数与动作不一致")
        return self


class ClearOverridesRequest(RevisionRequest):
    ids: list[str] = Field(min_length=1, max_length=20000)
    keys: list[str] = Field(min_length=1, max_length=8)

    @field_validator("keys")
    @classmethod
    def valid_keys(cls, keys):
        if not set(keys) <= FormatPatch.model_fields.keys():
            raise ValueError("未知的局部格式属性")
        return list(dict.fromkeys(keys))


class BulkAnnotationRequest(RevisionRequest):
    selector: Selector
    action: Literal["add_tag", "remove_tag", "set_role", "reset_role"]
    tag: str | None = Field(default=None, min_length=1, max_length=40)
    role: Role | None = None

    @model_validator(mode="after")
    def valid_action(self):
        if self.action in ("add_tag", "remove_tag"):
            if not self.tag or not self.tag.strip() or self.role is not None:
                raise ValueError("请填写标签，且不要同时指定类别")
            self.tag = self.tag.strip()
        elif self.tag is not None or (self.action == "set_role") != (self.role is not None):
            raise ValueError("类别操作参数与动作不一致")
        return self
