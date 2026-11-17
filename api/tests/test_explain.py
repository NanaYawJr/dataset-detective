import json

import httpx
import pytest
from fastapi.testclient import TestClient

from app.explain import SYSTEM_PROMPT, Settings
from app.main import create_app

CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0 Safari/537.36"

SUMMARY = {
    "file": {"format": "delimited", "rows": 1378, "columns": 3, "sampled": False, "grain": None},
    "columns": [
        {"name": "Order Date", "type": "date", "role": "date", "missing_share": 0, "distinct": 340, "date_order": "day-first"},
        {"name": "Discount", "type": "percent", "role": "measure", "missing_share": 0, "distinct": 11},
        {"name": "Order Priority", "type": "text", "role": "category", "missing_share": 0.22, "distinct": 5},
    ],
    "findings": [
        {"subject": "Order Priority", "severity": "warn", "title": "Placeholder values hide missing data", "rows": 300},
    ],
}


class FakeProviders:
    """Stands in for Claude and OpenAI, recording what was sent."""

    def __init__(self, anthropic=200, openai=200):
        self.status = {"api.anthropic.com": anthropic, "api.openai.com": openai}
        self.calls: list[tuple[str, dict, dict]] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        host = request.url.host
        self.calls.append((host, dict(request.headers), json.loads(request.content)))
        status = self.status[host]
        if status != 200:
            return httpx.Response(status, json={"error": "nope"})
        if host == "api.anthropic.com":
            return httpx.Response(200, json={"content": [{"type": "text", "text": "From Claude."}]})
        return httpx.Response(200, json={"choices": [{"message": {"content": "From OpenAI."}}]})


def settings(**changes) -> Settings:
    base = dict(
        anthropic_key="sk-ant-owner",
        openai_key="sk-openai-owner",
        anthropic_model="claude-haiku-5-5",
        openai_model="gpt-4o-mini",
        enabled=True,
        per_visitor=5,
        per_day=200,
    )
    return Settings(**(base | changes))


def make(tmp_path, providers=None, **changes):
    providers = providers or FakeProviders()
    app = create_app(tmp_path, stats_password="pw", settings=settings(**changes), transport=httpx.MockTransport(providers))
    return TestClient(app), providers


def ask(client, body=None, ip="203.0.113.5", agent=CHROME):
    return client.post(
        "/api/explain", json=body or {"summary": SUMMARY}, headers={"X-Client-IP": ip, "User-Agent": agent}
    )


def test_explains_with_claude_and_sends_only_the_summary(tmp_path):
    client, providers = make(tmp_path)
    response = ask(client)
    assert response.status_code == 200
    assert response.json() == {"text": "From Claude.", "provider": "anthropic"}
    assert response.headers["cache-control"] == "no-store"

    host, headers, sent = providers.calls[0]
    assert host == "api.anthropic.com"
    assert headers["x-api-key"] == "sk-ant-owner"
    assert sent["model"] == "claude-haiku-5-5"
    assert sent["system"] == SYSTEM_PROMPT
    expected = json.loads(json.dumps(SUMMARY))
    del expected["file"]["grain"]  # empty fields are left out
    assert json.loads(sent["messages"][0]["content"]) == expected


def test_accepts_the_summary_exactly_as_the_page_sends_it(tmp_path):
    # The page leaves out empty optional fields (no grain, no date order, no row count, no comparison).
    client, _ = make(tmp_path)
    minimal = {
        "file": {"format": "excel", "rows": 3, "columns": 1, "sampled": False},
        "columns": [{"name": "a", "type": "text", "role": "category", "missing_share": 0, "distinct": 2}],
        "findings": [{"subject": "Whole file", "severity": "info", "title": "No column or pair of columns identifies a row"}],
    }
    assert ask(client, {"summary": minimal}).status_code == 200


def test_falls_back_to_openai_when_claude_fails(tmp_path):
    client, providers = make(tmp_path, FakeProviders(anthropic=500))
    assert ask(client).json() == {"text": "From OpenAI.", "provider": "openai"}
    assert [call[0] for call in providers.calls] == ["api.anthropic.com", "api.openai.com"]
    assert providers.calls[1][2]["messages"][0] == {"role": "system", "content": SYSTEM_PROMPT}


def test_failure_of_both_is_explained_and_not_counted(tmp_path):
    client, _ = make(tmp_path, FakeProviders(anthropic=500, openai=401), per_visitor=1)
    response = ask(client)
    assert response.status_code == 503
    assert "unavailable" in response.json()["detail"]
    # The failed attempt was refunded, so the visitor still has their one explanation.
    status = client.get("/api/explain", headers={"X-Client-IP": "203.0.113.5", "User-Agent": CHROME}).json()
    assert status["remaining"] == 1


def test_limits_per_visitor_and_per_day(tmp_path):
    client, _ = make(tmp_path, per_visitor=2, per_day=3)
    assert ask(client).status_code == 200
    assert ask(client).status_code == 200
    third = ask(client)
    assert third.status_code == 429
    assert "today's 2 free explanations" in third.json()["detail"]

    assert ask(client, ip="203.0.113.9").status_code == 200
    site = ask(client, ip="203.0.113.10")
    assert site.status_code == 429
    assert "The site has used today's free explanations" in site.json()["detail"]


def test_the_daily_total_survives_a_restart(tmp_path):
    client, _ = make(tmp_path, per_day=1)
    assert ask(client).status_code == 200
    client.app.state.explainer.close()
    again, _ = make(tmp_path, per_day=1)
    assert ask(again, ip="198.51.100.1").status_code == 429


def test_a_visitors_own_key_is_used_once_and_not_counted(tmp_path):
    client, providers = make(tmp_path, per_visitor=1)
    body = {"summary": SUMMARY, "provider": "openai", "api_key": "sk-visitor-123"}
    for _ in range(3):
        response = ask(client, body)
        assert response.status_code == 200
        assert response.json()["provider"] == "openai"
    assert {call[1]["authorization"] for call in providers.calls} == {"Bearer sk-visitor-123"}
    # None of that used the visitor's free explanation.
    assert ask(client).status_code == 200

    client.app.state.explainer.close()
    for name in ("explain.db", "usage.db"):
        if (tmp_path / name).exists():
            assert b"sk-visitor-123" not in (tmp_path / name).read_bytes()


def test_a_rejected_own_key_says_so(tmp_path):
    client, _ = make(tmp_path, FakeProviders(anthropic=401))
    response = ask(client, {"summary": SUMMARY, "provider": "anthropic", "api_key": "sk-wrong"})
    assert response.status_code == 401
    assert response.json()["detail"] == "The API key was not accepted."


def test_rejects_anything_that_is_not_a_summary(tmp_path):
    client, providers = make(tmp_path)
    leaky = json.loads(json.dumps(SUMMARY))
    leaky["columns"][0]["top_values"] = ["28/01/2025", "30/01/2025"]
    assert ask(client, {"summary": leaky}).status_code == 422
    rows = json.loads(json.dumps(SUMMARY)) | {"rows": [["1024", "4%"]]}
    assert ask(client, {"summary": rows}).status_code == 422
    long_name = json.loads(json.dumps(SUMMARY))
    long_name["columns"][0]["name"] = "x" * 500
    assert ask(client, {"summary": long_name}).status_code == 422
    assert providers.calls == []


def test_switched_off_or_without_keys(tmp_path):
    off, _ = make(tmp_path / "off", enabled=False)
    assert ask(off).status_code == 503
    assert off.get("/api/explain").json()["enabled"] is False

    keyless, _ = make(tmp_path / "keyless", anthropic_key="", openai_key="")
    status = keyless.get("/api/explain", headers={"User-Agent": CHROME}).json()
    assert status == {"enabled": True, "available": False, "remaining": 0, "own_key": True}
    assert "use your own API key" in ask(keyless).json()["detail"]
    own = ask(keyless, {"summary": SUMMARY, "provider": "anthropic", "api_key": "sk-visitor"})
    assert own.status_code == 200


def test_bots_are_turned_away(tmp_path):
    client, providers = make(tmp_path)
    assert ask(client, agent="python-requests/2.32").status_code == 403
    assert providers.calls == []
