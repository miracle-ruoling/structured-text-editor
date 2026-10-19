from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

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
    field: Literal["role", "tag", "context", "text"]
    op: Literal["is", "is_not", "contains", "not_contains"] = "is"
    value: str = Field(max_length=200)

    @model_validator(mode="after")
    def valid_condition(self):
        if self.field == "role" and self.value not in ROLES:
            raise ValueError("未知类别")
        if self.field == "context" and self.value not in ("table", "outside_table"):
            raise ValueError("未知结构位置")
        if self.field != "text" and self.op not in ("is", "is_not"):
            raise ValueError("这个字段仅支持是/不是")
        return self


class Selector(Model):
    mode: Literal["all", "any"] = "all"
    conditions: list[Condition | Selector] = Field(default_factory=list, max_length=30)

    @model_validator(mode="after")
    def limit_tree(self):
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


class Snapshot(Model):
    label: str
    annotations: dict[str, Annotation]


class Project(Model):
    version: Literal[1] = 1
    id: str
    name: str
    source_sha256: str
    revision: int = 0
    annotations: dict[str, Annotation] = Field(default_factory=dict)
    undo: list[Snapshot] = Field(default_factory=list, max_length=50)
    redo: list[Snapshot] = Field(default_factory=list, max_length=50)
    updated_at: str = ""


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
    tags: list[str] | None = Field(default=None, max_length=30)

    @field_validator("tags")
    @classmethod
    def clean_tags(cls, value):
        return None if value is None else Annotation(tags=value).tags


class RevisionRequest(Model):
    revision: int
