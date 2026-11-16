"""The small server that sits beside the static site.

It is only reachable through the web server, on the same address as the
site, so the page still talks to nothing but its own origin.
"""

from __future__ import annotations

import hmac
import os
import time
from collections import defaultdict, deque
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, Header, HTTPException, Response
from pydantic import BaseModel

from .usage import UsageStore

FAILED_ATTEMPTS = 5
FAILED_WINDOW_SECONDS = 300


class Event(BaseModel):
    type: Literal["visit", "profile"]
    kind: Literal["delimited", "excel", "parquet", "json"] | None = None


def create_app(data_dir: Path | None = None, stats_password: str | None = None) -> FastAPI:
    store = UsageStore((data_dir or Path(os.environ.get("DATA_DIR", "data"))) / "usage.db")
    password = stats_password if stats_password is not None else os.environ.get("STATS_PASSWORD", "")
    failures: dict[str, deque[float]] = defaultdict(deque)

    # No interactive docs or schema: the fewer pages the server offers, the less there is to probe.
    app = FastAPI(title="Dataset Detective", docs_url=None, redoc_url=None, openapi_url=None)
    app.state.store = store

    @app.get("/api/health")
    def health() -> dict:
        return {"ok": True}

    @app.post("/api/event", status_code=204)
    def event(
        body: Event,
        x_client_ip: str = Header(default=""),
        user_agent: str = Header(default=""),
    ) -> Response:
        store.record(body.type, body.kind, x_client_ip, user_agent)
        return Response(status_code=204)

    @app.get("/api/stats")
    def stats(
        response: Response,
        authorization: str = Header(default=""),
        x_client_ip: str = Header(default=""),
    ) -> dict:
        response.headers["Cache-Control"] = "no-store"
        if not password:
            raise HTTPException(503, "The stats page is switched off: no STATS_PASSWORD is set on the server.")

        recent = failures[x_client_ip]
        now = time.monotonic()
        while recent and now - recent[0] > FAILED_WINDOW_SECONDS:
            recent.popleft()
        if len(recent) >= FAILED_ATTEMPTS:
            raise HTTPException(429, "Too many wrong passwords. Wait a few minutes and try again.")

        given = authorization.removeprefix("Bearer ").strip()
        if not hmac.compare_digest(given.encode(), password.encode()):
            recent.append(now)
            raise HTTPException(401, "Wrong password.")
        return store.summary()

    return app

