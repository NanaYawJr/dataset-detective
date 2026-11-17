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

import httpx
from fastapi import FastAPI, Header, HTTPException, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from .explain import ExplainError, Explainer, ExplainRequest, Settings
from .usage import UsageStore, is_bot

FAILED_ATTEMPTS = 5
FAILED_WINDOW_SECONDS = 300


class Event(BaseModel):
    type: Literal["visit", "profile"]
    kind: Literal["delimited", "excel", "parquet", "json"] | None = None


def settings_from_env() -> Settings:
    env = os.environ.get
    return Settings(
        anthropic_key=env("ANTHROPIC_API_KEY", ""),
        openai_key=env("OPENAI_API_KEY", ""),
        anthropic_model=env("ANTHROPIC_MODEL", "claude-haiku-5-5"),
        openai_model=env("OPENAI_MODEL", "gpt-4o-mini"),
        enabled=env("EXPLAIN_ENABLED", "1") != "0",
        per_visitor=int(env("EXPLAIN_PER_VISITOR", "5")),
        per_day=int(env("EXPLAIN_PER_DAY", "200")),
    )


def create_app(
    data_dir: Path | None = None,
    stats_password: str | None = None,
    settings: Settings | None = None,
    transport: httpx.BaseTransport | None = None,
) -> FastAPI:
    data = data_dir or Path(os.environ.get("DATA_DIR", "data"))
    store = UsageStore(data / "usage.db")
    explainer = Explainer(data, settings or settings_from_env(), transport)
    password = stats_password if stats_password is not None else os.environ.get("STATS_PASSWORD", "")
    failures: dict[str, deque[float]] = defaultdict(deque)

    # No interactive docs or schema: the fewer pages the server offers, the less there is to probe.
    app = FastAPI(title="Dataset Detective", docs_url=None, redoc_url=None, openapi_url=None)
    app.state.store = store
    app.state.explainer = explainer

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

    @app.get("/api/explain")
    def explain_status(
        response: Response,
        x_client_ip: str = Header(default=""),
        user_agent: str = Header(default=""),
    ) -> dict:
        response.headers["Cache-Control"] = "no-store"
        return explainer.status(x_client_ip, user_agent)

    @app.post("/api/explain")
    def explain(
        body: ExplainRequest,
        x_client_ip: str = Header(default=""),
        user_agent: str = Header(default=""),
    ):
        headers = {"Cache-Control": "no-store"}
        if is_bot(user_agent):
            return JSONResponse({"detail": "Explanations are for people using the site."}, status_code=403, headers=headers)
        try:
            return JSONResponse(explainer.explain(body, x_client_ip, user_agent), headers=headers)
        except ExplainError as error:
            return JSONResponse({"detail": error.message}, status_code=error.status, headers=headers)

    return app

