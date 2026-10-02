"""FastAPI application for Släktträff 2026."""
import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.database import Base, engine
from app.migrations import run_startup_migrations
from app.routers import (
    admin, auth, change_log, persons, registrations, rsvp_replies,
)
from app.seed import seed_persons_if_empty

# Create database tables, backfill columns on pre-existing DBs, and seed the
# family tree on a fresh database.
Base.metadata.create_all(bind=engine)
run_startup_migrations(engine)
seed_persons_if_empty()

# API docs (/docs, /openapi.json) are disabled by default — free reconnaissance
# on a public site. Set SLAKTTRAFF_DEBUG=1 to re-enable them in development.
_debug = os.environ.get("SLAKTTRAFF_DEBUG", "") == "1"
app = FastAPI(
    title="Släktträff 2026 API",
    description="API for family tree and registration management",
    version="1.1.0",
    docs_url="/docs" if _debug else None,
    redoc_url="/redoc" if _debug else None,
    openapi_url="/openapi.json" if _debug else None,
)

# CORS: explicit origins only (comma-separated env), never wildcard + credentials.
_origins = [o.strip() for o in os.environ.get("SLAKTTRAFF_CORS_ORIGINS", "").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["*"],
)

# Include routers
app.include_router(admin.router)
app.include_router(auth.router)
app.include_router(change_log.router)
app.include_router(persons.router)
app.include_router(registrations.router)
app.include_router(rsvp_replies.router)


@app.get("/health")
def health_check():
    return {"status": "ok", "app": "Släktträff 2026"}


# Serve the frontend (teddy/) from the same origin: GET / serves the tree page.
# Mounted last so /api/* and /health keep precedence.
_TEDDY_DIR = Path(__file__).resolve().parent.parent / "teddy"
app.mount("/", StaticFiles(directory=_TEDDY_DIR, html=True), name="teddy")
