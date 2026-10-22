"""Pure format projection: original document -> ordered rules -> local overrides."""

from copy import deepcopy

from .models import FormatPatch, Project, RuleRequest
from .selectors import missing_scopes, predicate
from .sizes import project_sizes
from .structure import assign_chapters

CONFLICTS = {"first_line_chars": "first_line_pt", "line_spacing": "line_spacing_pt"}
FONT_KEYS = {"font_east_asia", "font_latin", "size_pt", "bold", "italic"}


def overlay(block: dict, patch: dict, label: str):
    block["format"].update(patch)
    block["format_sources"].update(dict.fromkeys(patch, label))
    for key, alternate in CONFLICTS.items():
        if key in patch:
            block["format"].pop(alternate, None)
            block["format_sources"].pop(alternate, None)
    block["mixed"] = [key for key in block["mixed"] if key not in patch]
    if "size_pt" in patch:
        block["paragraph_size_pt"] = patch["size_pt"]
    if "line_spacing" in patch:
        block["format"].pop("line_spacing_rule", None)
        block["format_sources"].pop("line_spacing_rule", None)
    for run in block["runs"]:
        run["format"].update({k: v for k, v in patch.items() if k in FONT_KEYS})


def resolve(original: dict, project: Project, *, copy_view=True) -> dict:
    view = deepcopy(original) if copy_view else original
    stats = {rule.id: {"matched_count": 0, "effective_count": 0} for rule in project.rules}
    for block in view["blocks"]:
        annotation = project.annotations.get(block["id"])
        if annotation:
            if annotation.role is not None:
                block.update(role=annotation.role, role_source="手动指定", confirmed=True)
            block["tags"] = list(annotation.tags)
    view["chapters"] = assign_chapters(view["blocks"])
    compiled = []
    for rule in project.rules:
        missing = missing_scopes(view["blocks"], rule.selector)
        stats[rule.id]["scope_warning"] = (
            "范围已失效，规则暂不匹配：" + "、".join(missing) if missing else None
        )
        compiled.append((rule, predicate(rule.selector), bool(missing)))
    for block in view["blocks"]:
        annotation = project.annotations.get(block["id"])
        trace = {}
        for key in FormatPatch.model_fields:
            source_key = key if key in block["format"] else CONFLICTS.get(key, key)
            trace[key] = [
                {
                    "kind": "source",
                    "key": source_key,
                    "label": block["format_sources"].get(source_key, "原文档 / 未完整解析"),
                    "value": block["format"].get(source_key),
                    "mixed": key in block["mixed"],
                }
            ]
        effective = {}
        if block["editable"]:
            for rule, check, missing in compiled:
                if missing or not check(block):
                    continue
                stats[rule.id]["matched_count"] += 1
                if not rule.enabled:
                    continue
                patch = rule.patch.values()
                for key, value in patch.items():
                    trace[key].append(
                        {
                            "kind": "rule",
                            "key": key,
                            "rule_id": rule.id,
                            "label": f"规则：{rule.name}",
                            "value": value,
                        }
                    )
                effective.update(patch)
                overlay(block, patch, f"规则：{rule.name}")
            overrides = annotation.format.values() if annotation else {}
            for key, value in overrides.items():
                trace[key].append({"kind": "local", "key": key, "label": "本项目局部覆盖", "value": value})
            effective.update(overrides)
            overlay(block, overrides, "本项目局部覆盖")
            block["overrides"] = overrides
            if annotation and annotation.sizes:
                project_sizes(block, annotation.sizes)
                resolved_size = block["format"].get("size_pt")
                block["overrides"]["size_pt"] = resolved_size
                block["format_sources"]["size_pt"] = "本项目逐文字字号覆盖"
                trace["size_pt"].append(
                    {
                        "kind": "local",
                        "key": "size_pt",
                        "label": "本项目逐文字字号覆盖",
                        "value": resolved_size,
                        "mixed": "size_pt" in block["mixed"],
                    }
                )
        winners = {layers[-1]["rule_id"] for layers in trace.values() if layers[-1]["kind"] == "rule"}
        for identity in winners:
            stats[identity]["effective_count"] += 1
        block["format_trace"] = trace
        block["effective_patch"] = effective
    view["rules"] = [rule.model_dump(exclude_none=True) | stats[rule.id] for rule in project.rules]
    return view


def changed_rules(project: Project, request: RuleRequest):
    """Validate the entire replacement before any state or history is changed."""
    rules = deepcopy(project.rules)
    identity = request.rule.id if request.rule else request.id
    index = next((i for i, rule in enumerate(rules) if rule.id == identity), None)
    if request.action == "save":
        rule = request.rule.model_copy(deep=True)
        if any(r.id != rule.id and r.name.casefold() == rule.name.casefold() for r in rules):
            raise ValueError("已有同名规则，请使用另一个名称")
        if index is None:
            if len(rules) >= 50:
                raise ValueError("每个项目最多保存 50 条规则")
            rules.append(rule)
        else:
            rules[index] = rule
        label = f"保存规则：{rule.name}"
    else:
        if index is None:
            raise ValueError("该规则已经不存在，请刷新后重试")
        rule = rules[index]
        if request.action == "delete":
            rules.pop(index)
            label = f"删除规则：{rule.name}"
        elif request.action == "toggle":
            rule.enabled = request.enabled
            label = f"{'启用' if rule.enabled else '停用'}规则：{rule.name}"
        else:
            if request.position >= len(rules):
                raise ValueError("规则位置超出列表范围")
            rules.insert(request.position, rules.pop(index))
            label = f"调整规则顺序：{rule.name}"
    return rules, label
