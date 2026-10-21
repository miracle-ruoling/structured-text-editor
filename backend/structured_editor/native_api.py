from urllib.parse import quote

from fastapi import APIRouter, File, UploadFile
from fastapi.responses import Response

from .docx.native import export_native
from .domain.models import RevisionRequest
from .domain.native import NativeSave
from .native_store import NativeStore


def native_router(root, lock):
    router = APIRouter(prefix="/api/native")
    store = NativeStore(root)

    @router.get("")
    def recent():
        with lock:
            return store.recent()

    @router.post("")
    def create():
        with lock:
            return store.view(store.create())

    @router.post("/import")
    def import_native(file: UploadFile = File(...)):
        # History is included in backups; bound input before JSON parsing.
        limit = 128 * 1024 * 1024
        data = file.file.read(limit + 1)
        if len(data) > limit:
            raise ValueError("原生项目备份不能超过 128 MB")
        with lock:
            return store.view(store.create(data))

    @router.get("/{identity}")
    def get(identity: str):
        with lock:
            return store.view(store.load(identity))

    @router.post("/{identity}/save")
    def save(identity: str, operation: NativeSave):
        with lock:
            return store.view(store.update(identity, operation.revision, operation.content))

    @router.post("/{identity}/history/{direction}")
    def history(identity: str, direction: str, operation: RevisionRequest):
        if direction not in ("undo", "redo"):
            raise ValueError("未知的历史操作")
        with lock:
            return store.view(store.update(identity, operation.revision, direction=direction))

    @router.get("/{identity}/export/{kind}")
    def export(identity: str, kind: str, revision: int):
        with lock:
            project = store.load(identity)
            # A download must correspond to the version the user just saved.
            from .domain.commands import ConflictError
            if project.revision != revision:
                raise ConflictError("导出前文档已更新，请重新打开后导出")
            if kind == "docx":
                data = export_native(project.content)
                suffix = ".docx"
                media = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            elif kind == "project":
                data = project.model_dump_json().encode("utf-8")
                suffix = ".wnative.json"
                media = "application/json"
            else:
                raise ValueError("未知的导出类型")
            return Response(data, media_type=media, headers={
                "Content-Disposition": f"attachment; filename*=UTF-8''{quote(project.content.name + suffix)}"
            })

    return router
