"""Freeze old rules independently for the present and every historical state."""

from copy import deepcopy

from .commands import touch
from .models import Annotation, FormatPatch, LegacyRuleArchive, Project, Snapshot
from .rules import resolve


def freeze_rules(original: dict, project: Project) -> Project:
    states = [project, *project.undo, *project.redo]
    has_rules = any(state.rules for state in states)
    if not has_rules and project.version in (5, 6):
        return project
    if project.version == 6:
        raise ValueError("文字编辑项目不能包含持续规则")
    candidate = project.model_copy(deep=True)
    warnings = []
    if has_rules:
        # Repeated legacy API use is rejected after migration; keep the first full archive.
        if candidate.legacy_rule_archive is not None:
            raise ValueError("项目已迁移但又出现旧规则，请保留项目包并检查兼容调用。")
        candidate.legacy_rule_archive = LegacyRuleArchive(
            revision=project.revision,
            current=Snapshot(label="模板迁移前", annotations=deepcopy(project.annotations),
                             saved_selectors=deepcopy(project.saved_selectors), rules=deepcopy(project.rules)),
            undo=deepcopy(project.undo), redo=deepcopy(project.redo),
        )
        for state in [candidate, *candidate.undo, *candidate.redo]:
            if not state.rules:
                continue
            temporary = project.model_copy(update={"annotations": state.annotations, "rules": state.rules})
            view = resolve(original, temporary)
            for rule in view["rules"]:
                if rule["enabled"] and rule.get("scope_warning"):
                    warnings.append(f"旧规则「{rule['name']}」未冻结格式：{rule['scope_warning']}")
            for block in view["blocks"]:
                if block["effective_patch"]:
                    annotation = state.annotations.setdefault(block["id"], Annotation())
                    annotation.format = FormatPatch(**block["effective_patch"])
            state.rules = []
        candidate.legacy_rule_archive.warnings = list(dict.fromkeys(warnings))
    candidate.version = 5
    touch(candidate)
    return Project.model_validate(candidate.model_dump())
