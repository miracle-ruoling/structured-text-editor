import re
from uuid import uuid4

from .domain.native import NativeProject, change_native, new_native, touch_native
from .storage import atomic_write


class NativeStore:
    def __init__(self, root):
        self.root = root / "native"
        self.root.mkdir(parents=True, exist_ok=True)

    def path(self, identity):
        if not re.fullmatch(r"[0-9a-f]{32}", identity):
            raise ValueError("无效的原生文档 ID")
        return self.root / f"{identity}.json"

    def load(self, identity):
        path = self.path(identity)
        if not path.is_file():
            raise FileNotFoundError("原生文档不存在")
        return NativeProject.model_validate_json(path.read_bytes())

    def save(self, project):
        atomic_write(self.path(project.id), project.model_dump_json().encode("utf-8"))

    def create(self, data=None):
        project = NativeProject.model_validate_json(data) if data is not None else new_native()
        project.id = uuid4().hex
        touch_native(project)
        self.save(project)
        return project

    def update(self, identity, revision, content=None, direction=None):
        project = self.load(identity)
        if change_native(project, revision, content, direction):
            self.save(project)
        return project

    def recent(self):
        projects = []
        for path in self.root.glob("*.json"):
            if not re.fullmatch(r"[0-9a-f]{32}", path.stem):
                continue
            try:
                project = self.load(path.stem)
                projects.append({"id": project.id, "name": project.content.name,
                                 "updated_at": project.updated_at})
            except (ValueError, OSError):
                continue
        return sorted(projects, key=lambda p: p["updated_at"], reverse=True)[:30]

    @staticmethod
    def view(project):
        return {**project.model_dump(exclude={"undo", "redo"}),
                "can_undo": bool(project.undo), "can_redo": bool(project.redo)}
