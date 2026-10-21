"""Local global library; separate revision/history from any document."""

from pathlib import Path
from threading import RLock
from uuid import uuid4

from .domain.commands import ConflictError
from .domain.templates import StoredTemplate, TemplateIdentity, TemplateLibrary, TemplateSave
from .storage import atomic_write


class TemplateStore:
    def __init__(self, root: Path):
        self.path = root / "templates.json"
        self.lock = RLock()

    def load(self):
        return TemplateLibrary.model_validate_json(self.path.read_bytes()) if self.path.exists() else TemplateLibrary()

    def checked(self, revision):
        library = self.load()
        if library.revision != revision:
            raise ConflictError("模板库已更新，请刷新模板库后重试；模板草稿仍保留。")
        return library

    def write(self, library):
        library.revision += 1
        validated = TemplateLibrary.model_validate(library.model_dump())
        atomic_write(self.path, validated.model_dump_json(indent=2).encode("utf-8"))
        return validated

    def save(self, request: TemplateSave):
        library = self.checked(request.revision)
        if request.id and not any(item.id == request.id for item in library.items):
            raise ValueError("模板已被删除，请刷新模板库或另存为新模板")
        item = StoredTemplate(**request.template.model_dump(), id=request.id or uuid4().hex)
        if any(old.id != item.id and old.name.casefold() == item.name.casefold() for old in library.items):
            raise ValueError("已有同名模板，请修改名称")
        library.items = [old for old in library.items if old.id != item.id] + [item]
        return self.write(library)

    def change(self, request: TemplateIdentity, restore=False):
        library = self.checked(request.revision)
        source = library.deleted if restore else library.items
        item = next((item for item in source if item.id == request.id), None)
        if item is None:
            raise ValueError("模板已不存在，请刷新模板库")
        source.remove(item)
        if restore:
            library.items.append(item)
        else:
            library.deleted = [*library.deleted[-19:], item]
        return self.write(library)
