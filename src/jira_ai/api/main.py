"""main.py — FastAPI application entry point for the Jira AI analytics API."""

import os
import base64
import secrets
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, Response

from src.jira_ai.api.routes import stats, ask
from src.jira_ai.api.routes import assess
from src.jira_ai.api.routes import docs
from src.jira_ai.api.routes import skills
from src.jira_ai.api.routes import settings
from src.jira_ai.api.routes import stakeholders
from src.jira_ai.api.routes import reports
from src.jira_ai.api.routes import projects
from src.jira_ai.api.routes import assistant
from src.jira_ai.logging_config import setup_logging

logger = setup_logging()
logger.info("Jira AI API service initializing...")

app = FastAPI(title="Jira AI API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---- Basic Auth (protects the whole app: pages, static files, API) ----
_AUTH_USER = os.environ.get("BASIC_AUTH_USER", "demo").strip()
_AUTH_PASS = os.environ.get("BASIC_AUTH_PASS", "Dem06435").strip()


# Paths that must work WITHOUT a password (health check for Cloud Run).
_OPEN_PATHS = {"/health"}


def _check_basic_auth(header: str | None) -> bool:
    """Return True if the Authorization header holds valid Basic credentials."""
    if not header or not header.startswith("Basic "):
        return False
    try:
        decoded = base64.b64decode(header[6:]).decode("utf-8")
        username, _, password = decoded.partition(":")
    except Exception:
        return False
    user_ok = secrets.compare_digest(username, _AUTH_USER)
    pass_ok = secrets.compare_digest(password, _AUTH_PASS)
    return user_ok and pass_ok


@app.middleware("http")
async def basic_auth_middleware(request: Request, call_next):
    if request.url.path in _OPEN_PATHS:
        return await call_next(request)

    if not _check_basic_auth(request.headers.get("Authorization")):
        return Response(
            status_code=401,
            headers={"WWW-Authenticate": "Basic"},
            content="Authentication required.",
        )

    response = await call_next(request)
    if request.url.path.endswith((".js", ".css", ".html")) or request.url.path == "/":
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response


# ---- API routes (must be registered BEFORE the static mount below) ----
app.include_router(stats.router)
app.include_router(ask.router)
app.include_router(assess.router)
app.include_router(docs.router)
app.include_router(skills.router)
app.include_router(settings.router)
app.include_router(stakeholders.router)
app.include_router(reports.router)
app.include_router(projects.router)
app.include_router(assistant.router)


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "service": "jira-ai-api"}


# ---- Frontend (served from the same app, so one URL / one password) ----
FRONTEND_DIR = Path(__file__).resolve().parents[3] / "frontend"


@app.get("/")
def serve_index():
    return FileResponse(FRONTEND_DIR / "index.html")


# Serves styles.css, app.js, and anything else in frontend/.
# This mount is last on purpose — it catches all remaining paths at "/".
app.mount("/", StaticFiles(directory=FRONTEND_DIR), name="static")
