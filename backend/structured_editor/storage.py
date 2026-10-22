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

from .docx.audit import audit_export
from .docx.editing import edit_document, editable_view, enable_editing, export_edited, package_for
from .docx.package import DocxPackage, open_zip
from .docx.reader import project_document
from .docx.sample import PROTECTED_TEXT, create_sample
from .docx.writer import export_docx
from .domain.commands import check_revision, commit, touch, travel
from .domain.migrations import freeze_rules
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
from .domain.pagination import pagination_warnings
from .domain.rules import changed_rules, resolve
from .domain.selectors import select
from .domain.sizes import changed_sizes, size_values
from .domain.templates import TemplateRequest, template_annotations


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
        self._editing_source = None
        self._paragraph_cache = {}

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

    def upgrade(self, project: Project) -> Project:
        upgraded = freeze_rules(self.original_view(project.id), project)
        if upgraded is not project:
            self.save(upgraded)
        return upgraded

    def recent(self) -> list[dict]:
        from .native_store import NativeStore
        native_store = NativeStore(self.root)
        origins = {p.native_origin for p in self.existing_projects() if p.native_origin}
        for path in native_store.root.glob('*.json'):
            if path.stem in origins:
                continue
            try:
                native = native_store.load(path.stem)
            except (ValueError, OSError):
                continue
            self.import_native(native)
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
            project = Project(version=5, id=identity, name=self.unique_name(name), source_sha256=checksum)
        else:
            if project.source_sha256 != checksum:
                raise ValueError("项目中的原文件校验失败。")
            for state in [project, *project.undo, *project.redo]:
                state_base = project_document(package_for(source, state.content))
                permitted = {b["id"] for b in state_base["blocks"] if b["editable"]}
                run_ids = {b["id"]: {str(r["index"]) for r in b["runs"]} for b in state_base["blocks"]}
                if not state.annotations.keys() <= permitted:
                    raise ValueError("项目包含无效或不支持修改的段落。")
                for paragraph_id, annotation in state.annotations.items():
                    if annotation.sizes and not annotation.sizes.runs.keys() <= run_ids[paragraph_id]:
                        raise ValueError("项目包含无效的逐文字字号定位。")
            if project.version == 6:
                all_ids = [int(i[1:]) for state in [project, *project.undo, *project.redo]
                           for i in package_for(source, state.content).by_id]
                project.next_paragraph = max(project.next_paragraph, max(all_ids, default=0) + 1)
            project.id = identity
            project.name = self.unique_name(project.name)
        # Finish migration before creating files, so a failed import leaves no partial project.
        project = freeze_rules(base, project)
        # A reopened source-only DOCX must not silently enter an existing editable copy.
        touch(project)
        folder = self.folder(identity)
        folder.mkdir()
        (folder / "source.docx").write_bytes(source)
        self.save(project)
        return project

    def import_native(self, native):
        from .docx.editing import snapshot
        from .docx.native import export_native
        from .domain.models import Snapshot
        states = [native.content, *native.undo, *native.redo]
        ids = {}
        for state in states:
            for block in state.blocks:
                ids.setdefault(block.id, f'p{len(ids) + 1}')
        def convert(state):
            package = DocxPackage(export_native(state))
            package.ids = {p: ids[b.id] for p, b in zip(package.paragraphs, state.blocks, strict=True)}
            return snapshot(package), {ids[b.id]: Annotation(role='heading' if b.kind == 'heading' else 'body') for b in state.blocks}
        source = export_native(native.content)
        content, annotations = convert(native.content)
        def history(states):
            return [Snapshot(label='原生文字编辑', content=convert(s)[0], annotations=convert(s)[1]) for s in states]
        project = Project(version=6, id=uuid.uuid4().hex, name=native.content.name + '.docx',
                          source_sha256=hashlib.sha256(source).hexdigest(), text_editing=True,
                          content=content, annotations=annotations, next_paragraph=len(ids) + 1,
                          undo=history(native.undo), redo=history(native.redo), native_origin=native.id)
        return self.create(source, project.name, project)

    def import_file(self, data: bytes, name: str) -> Project:
        name = Path(name.replace("\\", "/")).name[:180]
        if name.lower().endswith('.json'):
            from .domain.native import NativeProject
            return self.import_native(NativeProject.model_validate_json(data))
        if name.lower().endswith(".sdoc"):
            with open_zip(data) as archive:
                if "project.json" not in archive.namelist() or "source.docx" not in archive.namelist():
                    raise ValueError("项目包缺少原文件或项目信息。")
                project = Project.model_validate_json(archive.read("project.json"))
                source = archive.read("source.docx")
                if hashlib.sha256(source).hexdigest() != project.source_sha256:
                    raise ValueError("项目中的原文件校验失败。")
                base = project_document(DocxPackage(source))
                project = freeze_rules(base, project)
                # Reopening a portable snapshot must not create an identical local project.
                for existing in self.existing_projects():
                    if existing.source_sha256 != project.source_sha256:
                        continue
                    candidate = freeze_rules(base, existing)
                    if (
                        candidate.annotations == project.annotations
                        and candidate.content == project.content
                        and candidate.text_editing == project.text_editing
                        and candidate.next_paragraph == project.next_paragraph
                        and candidate.saved_selectors == project.saved_selectors
                        and candidate.rules == project.rules
                        and candidate.legacy_rule_archive == project.legacy_rule_archive
                        and candidate.undo == project.undo
                        and candidate.redo == project.redo
                    ):
                        if candidate is not existing:
                            self.save(candidate)
                        return candidate
                return self.create(source, name, project)
        if not name.lower().endswith(".docx"):
            raise ValueError("请选择 .docx 文件或 .sdoc 文序项目。")
        checksum = hashlib.sha256(data).hexdigest()
        matches = [p for p in self.existing_projects() if p.source_sha256 == checksum and not p.text_editing]
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
        view = resolve(self.base_view(project), project, copy_view=not project.text_editing)
        return {
            **view,
            "id": project.id,
            "text_editing": project.text_editing,
            "name": project.name,
            "revision": project.revision,
            "updated_at": project.updated_at,
            "saved_selectors": [s.model_dump(exclude_none=True) for s in project.saved_selectors],
            "undo_label": project.undo[-1].label if project.undo else None,
            "redo_label": project.redo[-1].label if project.redo else None,
            "legacy_migration": ({"archived": True, "warnings": project.legacy_rule_archive.warnings}
                                 if project.legacy_rule_archive else None),
        }

    def base_view(self, project):
        if not project.text_editing:
            return self.original_view(project.id)
        source = self.source(project.id)
        # Cache only one immutable source package; different style/theme definitions never share entries.
        if source != self._editing_source:
            self._editing_source = source
            self._paragraph_cache = {}
        return editable_view(source, project, self._paragraph_cache)

    def enable_text(self, project, revision):
        check_revision(project, revision)
        if enable_editing(self.source(project.id), project):
            self.save(project)
        return self.view(project)

    def edit_text(self, project, operation):
        focus = edit_document(self.source(project.id), project, operation)
        self.save(project)
        return {**self.view(project), "edit_focus": focus}

    def create_blank(self):
        from .docx.native import export_native
        from .domain.native import new_native
        native = new_native()
        project = self.create(export_native(native.content), self.unique_name('未命名文档.docx'))
        enable_editing(self.source(project.id), project)
        project.annotations['p1'] = Annotation(role='body')
        self.save(project)
        return project

    def prepare_template(self, project: Project, request: TemplateRequest):
        check_revision(project, request.revision)
        before = self.view(project)
        annotations, ids, counts, warnings = template_annotations(project.annotations, before["blocks"], request)
        after = self.view(project.model_copy(update={"annotations": annotations}))
        selected = set(ids)
        after_blocks, changes = [], []
        for old, new in zip(before["blocks"], after["blocks"]):
            if old["id"] not in selected:
                continue
            after_blocks.append({key: new[key] for key in ("id", "format", "runs", "mixed")})
            if any(old[key] != new[key] for key in ("format", "runs", "mixed")):
                changes.append({"id": old["id"], "text": old["text"], "before": old["format"], "after": new["format"],
                                "size_before": size_values(old), "size_after": size_values(new)})
        return annotations, {"revision": project.revision, "ids": ids, "counts": counts, "changes": changes,
                             "after_blocks": after_blocks, "warnings": warnings + pagination_warnings(after, selected)}

    def apply_template(self, project: Project, request: TemplateRequest):
        annotations, preview = self.prepare_template(project, request)
        if not preview["ids"]:
            raise ValueError("范围中没有模板对应的可编辑类别")
        if commit(project, annotations, f"应用模板「{request.template.name}」：{len(preview['ids'])} 段"):
            self.save(project)

    def prepare_format(self, project: Project, request: FormatRequest):
        check_revision(project, request.revision)
        before = self.view(project)
        ids = select(before["blocks"], request.selector)
        selected = set(ids)
        annotations = deepcopy(project.annotations)
        for block in before["blocks"]:
            if block["id"] not in selected:
                continue
            annotation = annotations.setdefault(block["id"], Annotation())
            values = annotation.format.values() | request.patch.values()
            if request.size_change:
                annotation.sizes = changed_sizes(block, request.size_change)
                values.pop("size_pt", None)
            elif request.patch.size_pt is not None:
                annotation.sizes = None
            annotation.format = FormatPatch(**values)
        candidate = project.model_copy(update={"annotations": annotations})
        return annotations, before, self.view(candidate), ids

    def preview(self, project: Project, request: FormatRequest, compact=False) -> dict:
        _, before, after, ids = self.prepare_format(project, request)
        selected = set(ids)
        keys = list(request.patch.values()) + (["size_pt"] if request.size_change else [])
        changes, after_blocks = [], []
        for old, new in zip(before["blocks"], after["blocks"]):
            if old["id"] in selected:
                after_blocks.append(
                    {key: new[key] for key in ("id", "format", "runs", "mixed")} if compact else new
                )
                changes.append(
                    {
                        "id": old["id"],
                        "text": old["text"],
                        "before": {key: old["format"].get(key) for key in keys},
                        "after": {key: new["format"].get(key) for key in keys},
                        "size_before": size_values(old),
                        "size_after": size_values(new),
                    }
                )
        return {
            "revision": project.revision,
            "ids": ids,
            "changes": changes,
            "after_blocks": after_blocks,
            "warnings": pagination_warnings(after, selected),
        }

    def apply(self, project: Project, request: FormatRequest):
        annotations, _, _, ids = self.prepare_format(project, request)
        label = (
            f"调整 {len(ids)} 个段落的格式"
            if request.size_change is None
            else f"增减 {len(ids)} 段的逐文字字号"
        )
        if commit(project, annotations, label):
            self.save(project)

    def annotate(self, project: Project, request: AnnotationRequest):
        check_revision(project, request.revision)
        editable = {b["id"] for b in self.base_view(project)["blocks"] if b["editable"]}
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
        if project.legacy_rule_archive:
            raise ValueError("旧规则已冻结，请使用类别模板")
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
            "warnings": pagination_warnings(after, {b["id"] for b in after_blocks}),
        }

    def change_rule(self, project: Project, request: RuleRequest):
        check_revision(project, request.revision)
        if project.legacy_rule_archive:
            raise ValueError("旧规则已冻结，请使用类别模板")
        rules, label = changed_rules(project, request)
        if commit(project, project.annotations, label, rules=rules):
            self.save(project)

    def clear_overrides(self, project: Project, request: ClearOverridesRequest):
        check_revision(project, request.revision)
        editable = {b["id"] for b in self.base_view(project)["blocks"] if b["editable"]}
        if not set(request.ids) <= editable:
            raise ValueError("选择中包含不支持修改的段落。")
        annotations = deepcopy(project.annotations)
        for identity in set(request.ids):
            if identity in annotations:
                values = annotations[identity].format.values()
                if "size_pt" in request.keys:
                    annotations[identity].sizes = None
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

    def export_annotations(self, project: Project, view=None) -> dict[str, Annotation]:
        return {
            b["id"]: Annotation(
                format=FormatPatch(**b["effective_patch"]),
                sizes=project.annotations.get(b["id"], Annotation()).sizes,
            )
            for b in (view or self.view(project))["blocks"]
            if b["effective_patch"] or (b["id"] in project.annotations and project.annotations[b["id"]].sizes)
        }

    def word_export(self, project: Project):
        view = self.view(project)
        annotations = self.export_annotations(project, view)
        source = self.source(project.id)
        if project.text_editing:
            return export_edited(source, project.content, annotations), {"editing": True, "revision": project.revision}
        output = export_docx(source, annotations)
        audit = audit_export(source, output, set(annotations))
        original = {b["id"]: b for b in self.original_view(project.id)["blocks"]}
        current = {b["id"]: b for b in view["blocks"]}
        changes = []
        for identity in audit.pop("changed_ids"):
            old, new, annotation = original[identity], current[identity], annotations[identity]
            keys = list(annotation.format.values())
            if annotation.sizes and "size_pt" not in keys:
                keys.append("size_pt")
            changes.append(
                {
                    "id": identity,
                    "text": old["text"][:140],
                    "properties": [
                        {"key": key, "before": old["format"].get(key), "after": new["format"].get(key)}
                        for key in keys
                    ],
                    "size_before": size_values(old),
                    "size_after": size_values(new),
                }
            )
        report = {
            **audit,
            "revision": project.revision,
            "project_id": project.id,
            "name": project.name,
            "source_sha256": project.source_sha256,
            "output_sha256": hashlib.sha256(output).hexdigest(),
            "planned_paragraph_count": len(annotations),
            "changed_paragraphs": changes,
            "paragraph_count": len(view["blocks"]),
            "warnings": view["warnings"]
            + pagination_warnings(view, set(annotations))
            + [
                f"规则「{rule['name']}」{rule['scope_warning']}"
                for rule in view["rules"]
                if rule["enabled"] and rule.get("scope_warning")
            ],
            "limits": [
                "字号、行距和分页开关可能使 Word 重新分页；这里不验证精确页数。",
                "列表编号序列、条件表格样式、字体替代及网格在浏览器中可能显示不同。",
                "报告只包含已保存状态，当前未应用草稿不在其中。",
            ],
            "enabled_rules": sum(r.enabled for r in project.rules),
        }
        return output, report

    def export_project(self, project):
        output = io.BytesIO()
        with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("project.json", project.model_dump_json(indent=2))
            archive.writestr("source.docx", self.source(project.id))
        return output.getvalue()
