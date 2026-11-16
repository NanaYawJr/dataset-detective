from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.usage import UsageStore, is_bot

CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0 Safari/537.36"
FIREFOX = "Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0"


def send(client, type_, kind=None, ip="203.0.113.5", agent=CHROME):
    body = {"type": type_} | ({"kind": kind} if kind else {})
    return client.post("/api/event", json=body, headers={"X-Client-IP": ip, "User-Agent": agent})


@pytest.fixture
def client(tmp_path):
    return TestClient(create_app(tmp_path, stats_password="open-sesame"))


def stats(client, password="open-sesame", ip="198.51.100.1"):
    return client.get("/api/stats", headers={"Authorization": f"Bearer {password}", "X-Client-IP": ip})


def test_counts_visits_files_and_distinct_people(client):
    assert send(client, "visit").status_code == 204
    send(client, "visit")  # the same person again
    send(client, "visit", ip="203.0.113.9")
    send(client, "profile", "excel")
    send(client, "profile", "excel")
    send(client, "profile", "delimited", ip="203.0.113.9", agent=FIREFOX)

    body = stats(client).json()
    assert body["totals"] == {"visits": 3, "visitors": 2, "profiles": 3, "users": 2}
    assert body["formats"] == {"excel": 2, "delimited": 1}
    assert body["days"][0]["kinds"] == {"excel": 2, "delimited": 1}


def test_ignores_bots_and_unknown_events(client):
    send(client, "visit", agent="Googlebot/2.1 (+http://www.google.com/bot.html)")
    send(client, "visit", agent="")
    assert client.post("/api/event", json={"type": "purchase"}).status_code == 422
    assert client.post("/api/event", json={"type": "profile", "kind": "docx"}).status_code == 422
    assert stats(client).json()["totals"]["visits"] == 0
    assert is_bot("curl/8.5.0") and not is_bot(CHROME)


def test_one_person_cannot_swamp_the_totals(client):
    for _ in range(30):
        send(client, "visit")
    assert stats(client).json()["totals"] == {"visits": 20, "visitors": 1, "profiles": 0, "users": 0}


def test_stats_need_the_password(client):
    assert client.get("/api/stats").status_code == 401
    assert stats(client, "guess").status_code == 401
    assert stats(client).status_code == 200
    assert stats(client).headers["cache-control"] == "no-store"


def test_repeated_wrong_passwords_are_locked_out(client):
    for _ in range(5):
        assert stats(client, "guess", ip="192.0.2.7").status_code == 401
    assert stats(client, "open-sesame", ip="192.0.2.7").status_code == 429
    # Someone else is not locked out by another address's guesses.
    assert stats(client, ip="192.0.2.8").status_code == 200


def test_stats_are_off_without_a_password(tmp_path):
    client = TestClient(create_app(tmp_path, stats_password=""))
    assert client.get("/api/stats", headers={"Authorization": "Bearer "}).status_code == 503


def test_nothing_identifying_is_written_to_disk(client, tmp_path):
    send(client, "visit", ip="203.0.113.77")
    send(client, "profile", "json", ip="203.0.113.77")
    client.app.state.store.close()
    stored = (tmp_path / "usage.db").read_bytes()
    assert b"203.0.113.77" not in stored
    assert b"Mozilla" not in stored


def test_a_new_day_starts_a_new_count_and_forgets_visitors(tmp_path):
    day = ["2026-11-16"]
    store = UsageStore(Path(tmp_path) / "usage.db", clock=lambda: day[0])
    store.record("visit", None, "203.0.113.5", CHROME)
    key_before = store._key
    day[0] = "2026-11-17"
    store.record("visit", None, "203.0.113.5", CHROME)

    summary = store.summary()
    assert [d["day"] for d in summary["days"]] == ["2026-11-17", "2026-11-16"]
    # The same person on two days counts once per day: they cannot be linked across days.
    assert summary["totals"] == {"visits": 2, "visitors": 2, "profiles": 0, "users": 0}
    assert store._key != key_before


def test_counts_survive_a_restart(tmp_path):
    first = TestClient(create_app(tmp_path, stats_password="pw"))
    send(first, "profile", "parquet")
    first.app.state.store.close()
    second = TestClient(create_app(tmp_path, stats_password="pw"))
    assert stats(second, "pw").json()["totals"]["profiles"] == 1


def test_health(client):
    assert client.get("/api/health").json() == {"ok": True}
    assert client.get("/docs").status_code == 404
