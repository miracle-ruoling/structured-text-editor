from __future__ import annotations

import hashlib
import io
import os
import re
import uuid
import zipfile
from copy import deepcopy
from functools import lru_cache
from pathlib import Path
from threading import RLock

from .docx.package import DocxPackage, open_zip
from .docx.reader import project_document
from .docx.sample import PROTECTED_TEXT, create_sample
from .domain.commands import check_revision, commit, touch, travel
from .domain.models import (
    Annotation,
    AnnotationRequest,
    BulkAnnotationRequest,
    ClearOverridesRequest,
    DeleteSelectorRequest,
    FormatPatch,
    FormatRequest,
    Project,
    RuleRequest,
    SavedSelector,
    SaveSelectorRequest,
)
from .domain.rules import changed_rules, resolve
from .domain.selectors import select


def atomic_write(path: Path, data: bytes):
    temporary = path.with_name(path.name + ".tmp")
    with temporary.open("wb") as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)


class ProjectStore:
    def __init__(self, root: Path):
        self.root = root
        root.mkdir(parents=True, exist_ok=True)
        self.lock = RLock()

    def folder(self, identity: str) -> Path:
        if not re.fullmatch(r"[0-9a-f]{32}", identity):
            raise ValueError("无效的项目 ID")
        return self.root / identity

    def load(self, identity: str) -> Project:
        path = self.folder(identity) / "project.json"
        if not path.is_file():
            raise FileNotFoundError("项目不存在，请重新导入文件。")
        return Project.model_validate_json(path.read_bytes())

    def save(self, project: Project):
        atomic_write(
            self.folder(project.id) / "project.json", project.model_dump_json(indent=2).encode("utf-8")
        )

    def recent(self) -> list[dict]:
        projects = []
        for folder in self.root.iterdir():
            if not folder.is_dir() or not re.fullmatch(r"[0-9a-f]{32}", folder.name):
                continue
            try:
                project = self.load(folder.name)
                projects.append(
                    {
                        "id": project.id,
                        "name": project.name,
                        "updated_at": project.updated_at,
                        "revision": project.revision,
                    }
                )
            except (OSError, ValueError):
                continue
        return sorted(projects, key=lambda p: p["updated_at"], reverse=True)[:30]

    def existing_projects(self):
        for folder in self.root.iterdir():
            if folder.is_dir() and re.fullmatch(r"[0-9a-f]{32}", folder.name):
                try:
                    yield self.load(folder.name)
                except (OSError, ValueError):
                    continue

    def unique_name(self, name: str) -> str:
        names = {p.name for p in self.existing_projects()}
        if name not in names:
            return name
        path = Path(name)
        number = 2
        while f"{path.stem} · 项目 {number}{path.suffix}" in names:
            number += 1
        return f"{path.stem} · 项目 {number}{path.suffix}"

    @lru_cache(maxsize=8)
    def original_view(self, identity):
        return project_document(DocxPackage(self.source(identity)))

    def source(self, identity):
        return (self.folder(identity) / "source.docx").read_bytes()

    def create(self, source: bytes, name: str, project: Project | None = None) -> Project:
        base = project_document(DocxPackage(source))
        identity = uuid.uuid4().hex
        checksum = hashlib.sha256(source).hexdigest()
        if project is None:
            project = Project(id=identity, name=self.unique_name(name), source_sha256=checksum)
        else:
            if project.source_sha256 != checksum:
                raise ValueError("项目中的原文件校验失败。")
            permitted = {b["id"] for b in base["blocks"] if b["editable"]}
            for annotations in [project.annotations, *[s.annotations for s in project.undo + project.redo]]:
                if not annotations.keys() <= permitted:
                    raise ValueError("项目包含无效或不支持修改的段落。")
            project.id = identity
            project.name = self.unique_name(project.name)
        touch(project)
        folder = self.folder(identity)
        folder.mkdir()
        (folder / "source.docx").write_bytes(source)
        self.save(project)
        return project

    def import_file(self, data: bytes, name: str) -> Project:
        name = Path(name.replace("\\", "/")).name[:180]
        if name.lower().endswith(".sdoc"):
            with open_zip(data) as archive:
                if "project.json" not in archive.namelist() or "source.docx" not in archive.namelist():
                    raise ValueError("项目包缺少原文件或项目信息。")
                project = Project.model_validate_json(archive.read("project.json"))
                source = archive.read("source.docx")
                if hashlib.sha256(source).hexdigest() != project.source_sha256:
                    raise ValueError("项目中的原文件校验失败。")
                # Reopening a portable snapshot must not create an identical local project.
                for existing in self.existing_projects():
                    if (
                        existing.source_sha256 == project.source_sha256
                        and existing.annotations == project.annotations
                        and existing.saved_selectors == project.saved_selectors
                        and existing.rules == project.rules
                        and existing.undo == project.undo
                        and existing.redo == project.redo
                    ):
                        return existing
                return self.create(source, name, project)
        if not name.lower().endswith(".docx"):
            raise ValueError("请选择 .docx 文件或 .sdoc 文序项目。")
        checksum = hashlib.sha256(data).hexdigest()
        matches = [p for p in self.existing_projects() if p.source_sha256 == checksum]
        if matches:
            return max(matches, key=lambda p: p.updated_at)
        return self.create(data, name)

    def demo(self) -> Project:
        project = self.create(create_sample(), "结构化写作 · 示例.docx")
        for block in self.original_view(project.id)["blocks"]:
            if block["text"] == PROTECTED_TEXT:
                project.annotations[block["id"]] = Annotation(tags=["保留原格式"])
            elif block["text"].startswith("好的排版始于"):
                project.annotations[block["id"]] = Annotation(tags=["重点"])
        self.save(project)
        return project

    def view(self, project: Project) -> dict:
        view = resolve(self.original_view(project.id), project)
        return {
            **view,
            "id": project.id,
            "name": project.name,
            "revision": project.revision,
            "updated_at": project.updated_at,
            "saved_selectors": [s.model_dump(exclude_none=True) for s in project.saved_selectors],
            "undo_label": project.undo[-1].label if project.undo else None,
            "redo_label": project.redo[-1].label if project.redo else None,
        }

    def preview(self, project: Project, request: FormatRequest) -> dict:
        check_revision(project, request.revision)
        view = self.view(project)
        ids = select(view["blocks"], request.selector)
        selected = set(ids)
        patch = request.patch.values()
        changes = []
        for block in view["blocks"]:
            if block["id"] in selected:
                changes.append(
                    {
                        "id": block["id"],
                        "text": block["text"],
                        "before": {key: block["format"].get(key) for key in patch},
                        "after": patch,
                    }
                )
        return {"revision": project.revision, "ids": ids, "changes": changes}

    def apply(self, project: Project, request: FormatRequest):
        preview = self.preview(project, request)
        annotations = deepcopy(project.annotations)
        for identity in preview["ids"]:
            annotation = annotations.setdefault(identity, Annotation())
            annotation.format = FormatPatch(**(annotation.format.values() | request.patch.values()))
        if commit(project, annotations, f"调整 {len(preview['ids'])} 个段落的格式"):
            self.save(project)

    def annotate(self, project: Project, request: AnnotationRequest):
        check_revision(project, request.revision)
        editable = {b["id"] for b in self.original_view(project.id)["blocks"] if b["editable"]}
        if not set(request.ids) <= editable:
            raise ValueError("选择中包含不支持修改的段落。")
        annotations = deepcopy(project.annotations)
        for identity in set(request.ids):
            annotation = annotations.setdefault(identity, Annotation())
            if request.role is not None:
                annotation.role = request.role
            elif request.reset_role:
                annotation.role = None
            if request.tags is not None:
                annotation.tags = request.tags
        if commit(project, annotations, f"标注 {len(set(request.ids))} 个段落"):
            self.save(project)

    def save_selector(self, project: Project, request: SaveSelectorRequest):
        check_revision(project, request.revision)
        item = SavedSelector(id=uuid.uuid4().hex, name=request.name, selector=request.selector)
        if len(project.saved_selectors) >= 50:
            raise ValueError("每个项目最多保存 50 个筛选")
        if any(s.name.casefold() == item.name.casefold() for s in project.saved_selectors):
            raise ValueError("已有同名筛选，请使用另一个名称")
        if commit(project, project.annotations, f"保存筛选：{item.name}", [*project.saved_selectors, item]):
            self.save(project)

    def delete_selector(self, project: Project, request: DeleteSelectorRequest):
        check_revision(project, request.revision)
        item = next((s for s in project.saved_selectors if s.id == request.id), None)
        if item is None:
            raise ValueError("该筛选已经不存在，请刷新后重试")
        if commit(
            project,
            project.annotations,
            f"删除筛选：{item.name}",
            [s for s in project.saved_selectors if s.id != item.id],
        ):
            self.save(project)

    def history(self, project, revision, direction):
        check_revision(project, revision)
        travel(project, direction)
        self.save(project)

    def preview_rule(self, project: Project, request: RuleRequest):
        check_revision(project, request.revision)
        rules, label = changed_rules(project, request)
        candidate = project.model_copy(update={"rules": rules})
        before = self.view(project)
        after = self.view(candidate)
        changes, after_blocks = [], []
        for old, new in zip(before["blocks"], after["blocks"]):
            if any(old[key] != new[key] for key in ("format", "runs", "mixed")):
                after_blocks.append(new)
                changes.append(
                    {"id": old["id"], "text": old["text"], "before": old["format"], "after": new["format"]}
                )
        return {
            "revision": project.revision,
            "label": label,
            "ids": [b["id"] for b in after_blocks],
            "changes": changes,
            "after_blocks": after_blocks,
            "rules": after["rules"],
        }

    def change_rule(self, project: Project, request: RuleRequest):
        check_revision(project, request.revision)
        rules, label = changed_rules(project, request)
        if commit(project, project.annotations, label, rules=rules):
            self.save(project)

    def clear_overrides(self, project: Project, request: ClearOverridesRequest):
        check_revision(project, request.revision)
        editable = {b["id"] for b in self.original_view(project.id)["blocks"] if b["editable"]}
        if not set(request.ids) <= editable:
            raise ValueError("选择中包含不支持修改的段落。")
        annotations = deepcopy(project.annotations)
        for identity in set(request.ids):
            if identity in annotations:
                values = annotations[identity].format.values()
                annotations[identity].format = FormatPatch(
                    **{k: v for k, v in values.items() if k not in request.keys}
                )
        if commit(project, annotations, f"清除 {len(set(request.ids))} 段的局部格式覆盖"):
            self.save(project)

    def bulk_annotate(self, project: Project, request: BulkAnnotationRequest):
        check_revision(project, request.revision)
        ids = select(self.view(project)["blocks"], request.selector)
        if not ids:
            raise ValueError("没有匹配的可编辑段落")
        annotations = deepcopy(project.annotations)
        for identity in ids:
            previous = annotations.get(identity, Annotation())
            data = previous.model_dump()
            if request.action == "add_tag":
                if request.tag not in data["tags"]:
                    data["tags"].append(request.tag)
            elif request.action == "remove_tag":
                data["tags"] = [tag for tag in data["tags"] if tag != request.tag]
            else:
                data["role"] = request.role if request.action == "set_role" else None
            # Construct and validate every result before committing any of them.
            updated = Annotation(**data)
            if updated != previous:
                annotations[identity] = updated
        labels = {
            "add_tag": "添加标签",
            "remove_tag": "移除标签",
            "set_role": "设置类别",
            "reset_role": "恢复自动类别",
        }
        if commit(project, annotations, f"批量{labels[request.action]}：{len(ids)} 段"):
            self.save(project)

    def export_annotations(self, project: Project) -> dict[str, Annotation]:
        return {
            b["id"]: Annotation(format=FormatPatch(**b["effective_patch"]))
            for b in self.view(project)["blocks"]
            if b["effective_patch"]
        }

    def export_project(self, project):
        output = io.BytesIO()
        with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("project.json", project.model_dump_json(indent=2))
            archive.writestr("source.docx", self.source(project.id))
        return output.getvalue()
