from copy import deepcopy
from datetime import UTC, datetime

from .models import Project, Snapshot


class ConflictError(ValueError):
    pass


def check_revision(project: Project, revision: int):
    if project.revision != revision:
        raise ConflictError("文档已经更新，请重新预览后再操作。")


def touch(project: Project):
    project.revision += 1
    project.updated_at = datetime.now(UTC).isoformat()


def commit(project: Project, annotations: dict, label: str):
    if project.annotations == annotations:
        return False
    project.undo = [*project.undo[-49:], Snapshot(label=label, annotations=deepcopy(project.annotations))]
    project.redo = []
    project.annotations = annotations
    touch(project)
    return True


def travel(project: Project, direction: str):
    origin = project.undo if direction == "undo" else project.redo
    destination = project.redo if direction == "undo" else project.undo
    if not origin:
        raise ValueError("没有可撤销的操作" if direction == "undo" else "没有可重做的操作")
    snapshot = origin.pop()
    destination.append(Snapshot(label=snapshot.label, annotations=deepcopy(project.annotations)))
    if len(destination) > 50:
        del destination[0]
    project.annotations = deepcopy(snapshot.annotations)
    touch(project)
