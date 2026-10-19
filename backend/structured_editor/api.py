from pathlib import Path
from urllib.parse import quote

from fastapi import FastAPI, File, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.middleware.trustedhost import TrustedHostMiddleware

from .docx.package import MAX_UPLOAD
from .docx.writer import export_docx
from .domain.commands import ConflictError
from .domain.models import (
    AnnotationRequest,
    DeleteSelectorRequest,
    FormatRequest,
    RevisionRequest,
    SaveSelectorRequest,
    Selector,
)
from .domain.selectors import select
from .storage import ProjectStore

ROOT = Path(__file__).resolve().parents[2]


def create_app(data_dir: Path | None = None) -> FastAPI:
    app = FastAPI(title="文序", docs_url=None, redoc_url=None)
    store = ProjectStore(data_dir or ROOT / "data")
    app.state.store = store
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=["127.0.0.1", "localhost", "testserver"])

    @app.middleware("http")
    async def local_origin(request: Request, call_next):
        origin = request.headers.get("origin")
        allowed = {str(request.base_url).rstrip("/"), "http://127.0.0.1:5173", "http://localhost:5173"}
        if origin and origin not in allowed:
            return JSONResponse(status_code=403, content={"detail": "请从文序本机页面访问。"})
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        if request.url.path.startswith("/api"):
            response.headers["Cache-Control"] = "no-store"
        return response

    @app.exception_handler(ConflictError)
    async def conflict(_, exc):
        return JSONResponse(status_code=409, content={"detail": str(exc)})

    @app.exception_handler(ValueError)
    async def invalid(_, exc):
        return JSONResponse(status_code=400, content={"detail": str(exc)[:700]})

    @app.exception_handler(FileNotFoundError)
    async def missing(_, exc):
        return JSONResponse(status_code=404, content={"detail": str(exc)})

    @app.exception_handler(RequestValidationError)
    async def invalid_request(_, exc):
        errors = exc.errors()
        detail = "；".join(f"{'.'.join(str(p) for p in e['loc'][1:])}: {e['msg']}" for e in errors[:3])
        return JSONResponse(status_code=422, content={"detail": "输入无效：" + detail})

    @app.get("/api/health")
    def health():
        return {"app": "structured-editor", "version": "0.1.0"}

    @app.post("/api/projects/demo")
    def demo():
        with store.lock:
            return store.view(store.demo())

    @app.get("/api/projects")
    def recent_projects():
        with store.lock:
            return store.recent()

    @app.post("/api/projects/import")
    def import_file(file: UploadFile = File(...)):
        content = file.file.read(MAX_UPLOAD + 1)
        if len(content) > MAX_UPLOAD:
            raise ValueError("当前支持最大 30 MB 的文件。")
        with store.lock:
            return store.view(store.import_file(content, file.filename or "document.docx"))

    @app.get("/api/projects/{identity}")
    def get_project(identity: str):
        with store.lock:
            return store.view(store.load(identity))

    @app.post("/api/projects/{identity}/select")
    def selection(identity: str, selector: Selector):
        with store.lock:
            project = store.load(identity)
            return {"revision": project.revision, "ids": select(store.view(project)["blocks"], selector)}

    @app.post("/api/projects/{identity}/preview")
    def preview(identity: str, operation: FormatRequest):
        with store.lock:
            return store.preview(store.load(identity), operation)

    @app.post("/api/projects/{identity}/apply")
    def apply(identity: str, operation: FormatRequest):
        with store.lock:
            project = store.load(identity)
            store.apply(project, operation)
            return store.view(project)

    @app.post("/api/projects/{identity}/annotate")
    def annotate(identity: str, operation: AnnotationRequest):
        with store.lock:
            project = store.load(identity)
            store.annotate(project, operation)
            return store.view(project)

    @app.post("/api/projects/{identity}/undo")
    def undo(identity: str, operation: RevisionRequest):
        with store.lock:
            project = store.load(identity)
            store.history(project, operation.revision, "undo")
            return store.view(project)

    @app.post("/api/projects/{identity}/redo")
    def redo(identity: str, operation: RevisionRequest):
        with store.lock:
            project = store.load(identity)
            store.history(project, operation.revision, "redo")
            return store.view(project)

    @app.post("/api/projects/{identity}/selections/save")
    def save_selection(identity: str, operation: SaveSelectorRequest):
        with store.lock:
            project = store.load(identity)
            store.save_selector(project, operation)
            return store.view(project)

    @app.post("/api/projects/{identity}/selections/delete")
    def delete_selection(identity: str, operation: DeleteSelectorRequest):
        with store.lock:
            project = store.load(identity)
            store.delete_selector(project, operation)
            return store.view(project)

    def download(content: bytes, name: str, mime: str):
        return Response(
            content,
            media_type=mime,
            headers={
                "Content-Disposition": f"attachment; filename=export{Path(name).suffix}; filename*=UTF-8''{quote(name)}"
            },
        )

    @app.get("/api/projects/{identity}/export/docx")
    def export_word(identity: str):
        with store.lock:
            project = store.load(identity)
            content = export_docx(store.source(identity), project.annotations)
            return download(
                content,
                Path(project.name).stem + "_文序.docx",
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            )

    @app.get("/api/projects/{identity}/export/project")
    def export_project(identity: str):
        with store.lock:
            project = store.load(identity)
            return download(
                store.export_project(project), Path(project.name).stem + ".sdoc", "application/zip"
            )

    dist = ROOT / "frontend" / "dist"
    if dist.is_dir():
        app.mount("/", StaticFiles(directory=dist, html=True), name="frontend")
    else:

        @app.get("/")
        def frontend_missing():
            return JSONResponse(
                status_code=503, content={"detail": "请先在 frontend 目录执行 npm run build。"}
            )

    return app
