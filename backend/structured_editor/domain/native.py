"""Versioned native content; independent of HTTP and source DOCX coordinates."""

from datetime import UTC, datetime
from typing import Literal
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .commands import ConflictError


class NativeModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class NativeBlock(NativeModel):
    id: str = Field(pattern=r"^[0-9a-f]{32}$")
    kind: Literal["paragraph", "heading"] = "paragraph"
    level: int | None = Field(default=None, ge=1, le=3)
    text: str = Field(default="", max_length=100000)

    @model_validator(mode="after")
    def valid_block(self):
        if (self.kind == "heading") != (self.level is not None):
            raise ValueError("标题需要 1 至 3 级，正文不能设置标题级别")
        # Text must be representable in XML 1.0; tabs/newlines remain explicit text.
        if any(not (c in "\t\n\r" or 0x20 <= ord(c) <= 0xD7FF or 0xE000 <= ord(c) <= 0xFFFD
                    or 0x10000 <= ord(c) <= 0x10FFFF) for c in self.text):
            raise ValueError("文字包含 Word 无法保存的控制字符")
        return self


class NativeContent(NativeModel):
    name: str = Field(default="未命名文档", min_length=1, max_length=120)
    blocks: list[NativeBlock] = Field(min_length=1, max_length=2000)

    @field_validator("name")
    @classmethod
    def clean_name(cls, name):
        name = name.strip()
        if not name or any(ord(c) < 32 or c in '/\\:*?"<>|' for c in name):
            raise ValueError("文档名不能为空，也不能包含路径或控制字符")
        return name

    @model_validator(mode="after")
    def valid_content(self):
        if len({b.id for b in self.blocks}) != len(self.blocks):
            raise ValueError("段落 ID 不能重复")
        if sum(len(b.text) for b in self.blocks) > 200000:
            raise ValueError("本阶段原生文档最多支持 20 万字符")
        return self


class NativeProject(NativeModel):
    format: Literal["wenxu-native"] = "wenxu-native"
    version: Literal[1] = 1
    id: str = Field(pattern=r"^[0-9a-f]{32}$")
    revision: int = Field(default=0, ge=0)
    updated_at: str = ""
    content: NativeContent
    undo: list[NativeContent] = Field(default_factory=list, max_length=50)
    redo: list[NativeContent] = Field(default_factory=list, max_length=50)


class NativeSave(NativeModel):
    revision: int = Field(ge=0)
    content: NativeContent


def new_native() -> NativeProject:
    return NativeProject(id=uuid4().hex, content=NativeContent(blocks=[NativeBlock(id=uuid4().hex)]))


def touch_native(project: NativeProject):
    project.revision += 1
    project.updated_at = datetime.now(UTC).isoformat()


def change_native(project: NativeProject, revision: int, content: NativeContent | None = None,
                  direction: Literal["undo", "redo"] | None = None) -> bool:
    if project.revision != revision:
        raise ConflictError("文档已在其他页面更新。本地输入已保留；请下载本地草稿后重新打开文档。")
    if direction:
        origin = getattr(project, direction)
        if not origin:
            return False
        target = project.redo if direction == "undo" else project.undo
        target.append(project.content.model_copy(deep=True))
        del target[:-50]
        project.content = origin.pop()
    else:
        if content is None or content == project.content:
            return False
        project.undo = [*project.undo[-49:], project.content.model_copy(deep=True)]
        project.redo = []
        project.content = content.model_copy(deep=True)
    touch_native(project)
    return True
