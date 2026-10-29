from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .config import settings
from .db import Base, engine
from .routers import admin, auth, cases, patients, privacy

FRONTEND = Path(__file__).resolve().parents[2] / "frontend"


def create_app() -> FastAPI:
    settings.validate()
    Base.metadata.create_all(engine)
    app = FastAPI(title="HAEM5 Reporter API", version="1.0.0", docs_url="/api/docs", redoc_url=None, openapi_url="/api/openapi.json")

    if settings.cors_origins:
        app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_methods=["*"], allow_headers=["Authorization", "Content-Type"])

    @app.middleware("http")
    async def security_headers(request: Request, call_next):
        resp = await call_next(request)
        h = resp.headers
        h["X-Content-Type-Options"] = "nosniff"
        h["X-Frame-Options"] = "DENY"
        h["Referrer-Policy"] = "no-referrer"
        h["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        h["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        if request.url.path.startswith("/api/docs"):
            pass  # Swagger UI loads its own CDN assets
        else:
            h["Content-Security-Policy"] = ("default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://cdn.jsdelivr.net; "
                                            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; "
                                            "img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
        if request.url.path.startswith("/api/"):
            h["Cache-Control"] = "no-store"
        return resp

    @app.exception_handler(Exception)
    async def unhandled(request: Request, exc: Exception):
        # Never leak internals (which could include personal data) in error responses.
        return JSONResponse({"detail": "Something went wrong on the server. The error has been logged."}, status_code=500)

    for r in (auth.router, patients.router, cases.router, privacy.router, admin.router):
        app.include_router(r)

    @app.get("/api/health")
    def health():
        return {"ok": True, "demo": settings.demo_mode}

    if FRONTEND.exists():
        app.mount("/static", StaticFiles(directory=FRONTEND), name="static")

        @app.get("/")
        def index():
            return FileResponse(FRONTEND / "index.html")

        @app.get("/privacy")
        def privacy_page():
            return FileResponse(FRONTEND / "privacy.html")

        @app.get("/workbench")
        def workbench():
            return FileResponse(FRONTEND / "workbench.html")

    return app


app = create_app()
