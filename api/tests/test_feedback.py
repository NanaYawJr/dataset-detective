import datetime as dt
import json

import httpx
from fastapi.testclient import TestClient

from app.feedback import AlertSettings, FeedbackIn, FeedbackStore
from app.main import create_app

CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0 Safari/537.36"


class FakeResend:
    def __init__(self, status=200):
        self.status = status
        self.sent: list[tuple[dict, dict]] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.sent.append((dict(request.headers), json.loads(request.content)))
        return httpx.Response(self.status, json={"id": "abc"})


def alerts(**changes) -> AlertSettings:
    base = dict(resend_key="re_test", to="owner@example.com", sender="Dataset Detective <onboarding@resend.dev>", site_url="https://detective.example.com")
    return AlertSettings(**(base | changes))


def make(tmp_path, resend=None, **changes):
    resend = resend or FakeResend()
    app = create_app(tmp_path, stats_password="pw", transport=httpx.MockTransport(resend), alerts=alerts(**changes))
    return TestClient(app), resend


def send(client, body, ip="203.0.113.5", agent=CHROME):
    return client.post("/api/feedback", json=body, headers={"X-Client-IP": ip, "User-Agent": agent})


def listing(client, password="pw"):
    return client.get("/api/feedback", headers={"Authorization": f"Bearer {password}", "X-Client-IP": "198.51.100.1"})


def test_saves_a_rating_with_or_without_a_comment(tmp_path):
    client, _ = make(tmp_path)
    assert send(client, {"rating": 4}).status_code == 204
    assert send(client, {"rating": 2, "comment": "  Dates were read the wrong way round.  ", "app_version": "0.7.0", "file_kind": "excel"}).status_code == 204

    body = listing(client).json()
    assert body["count"] == 2
    assert body["average"] == 3.0
    assert body["ratings"] == {"1": 0, "2": 1, "3": 0, "4": 1, "5": 0}
    newest = body["entries"][0]
    assert newest | {"id": 0, "created_at": ""} == {
        "id": 0,
        "created_at": "",
        "rating": 2,
        "comment": "Dates were read the wrong way round.",
        "wants_reply": False,
        "name": "",
        "country": "",
        "email": "",
        "app_version": "0.7.0",
        "file_kind": "excel",
    }
    assert body["retention_days"] == 365
    assert body["alerts"] is True


def test_rejects_what_it_should(tmp_path):
    client, _ = make(tmp_path)
    assert send(client, {}).status_code == 422
    assert send(client, {"rating": 6}).status_code == 422
    assert send(client, {"rating": 3, "comment": "x" * 2001}).status_code == 422
    assert send(client, {"rating": 3, "file_kind": "docx"}).status_code == 422
    assert send(client, {"rating": 3, "file_name": "payroll.csv"}).status_code == 422
    reply = send(client, {"rating": 3, "wants_reply": True, "email": "not-an-email"})
    assert reply.status_code == 422
    assert "Enter an email address" in json.dumps(reply.json())


def test_keeps_contact_details_only_when_a_reply_is_wanted(tmp_path):
    client, _ = make(tmp_path)
    send(client, {"rating": 5, "name": "Ama", "country": "Ghana", "email": "ama@example.com"})
    send(client, {"rating": 5, "wants_reply": True, "name": "Kofi", "country": "Canada", "email": "kofi@example.com"})
    first, second = reversed(listing(client).json()["entries"])
    assert (first["name"], first["country"], first["email"]) == ("", "", "")
    assert (second["name"], second["country"], second["email"]) == ("Kofi", "Canada", "kofi@example.com")


def test_emails_the_owner_and_lets_them_reply(tmp_path):
    client, resend = make(tmp_path)
    send(client, {"rating": 2, "comment": "Excel dates looked odd.", "wants_reply": True, "name": "Kofi", "country": "Canada", "email": "kofi@example.com", "app_version": "0.7.0", "file_kind": "excel"})
    send(client, {"rating": 5})

    (headers, reply), (_, plain) = resend.sent
    assert headers["authorization"] == "Bearer re_test"
    assert headers["user-agent"].startswith("dataset-detective")
    assert reply["to"] == ["owner@example.com"]
    assert reply["reply_to"] == "kofi@example.com"
    assert reply["subject"] == "Dataset Detective feedback: 2/5 (reply wanted)"
    assert "Excel dates looked odd." in reply["text"]
    assert "They'd like a reply (Kofi, Canada): reply to this email to answer them." in reply["text"]
    assert "Sent from version 0.7.0, excel." in reply["text"]
    assert "https://detective.example.com/#stats" in reply["text"]
    assert "reply_to" not in plain
    assert "They didn't ask for a reply." in plain["text"]


def test_feedback_is_kept_even_if_the_email_fails_or_is_not_set_up(tmp_path):
    client, resend = make(tmp_path / "failing", FakeResend(status=500))
    assert send(client, {"rating": 3}).status_code == 204
    assert listing(client).json()["count"] == 1

    quiet, nothing = make(tmp_path / "quiet", resend_key="")
    send(quiet, {"rating": 3})
    assert nothing.sent == []
    assert listing(quiet).json()["count"] == 1
    assert listing(quiet).json()["alerts"] is False


def test_bots_the_hidden_field_and_floods_are_dropped_quietly(tmp_path):
    client, resend = make(tmp_path)
    assert send(client, {"rating": 5, "website": "http://spam.example"}).status_code == 204
    assert send(client, {"rating": 5}, agent="python-requests/2.32").status_code == 204
    for _ in range(8):
        assert send(client, {"rating": 4}, ip="192.0.2.9").status_code == 204
    assert listing(client).json()["count"] == 5
    assert len(resend.sent) == 5


def test_the_list_and_deletion_need_the_password(tmp_path):
    client, _ = make(tmp_path)
    send(client, {"rating": 1, "comment": "Delete me"})
    assert listing(client, "guess").status_code == 401
    entry = listing(client).json()["entries"][0]
    auth = {"Authorization": "Bearer pw", "X-Client-IP": "198.51.100.1"}
    assert client.delete(f"/api/feedback/{entry['id']}").status_code == 401
    assert client.delete(f"/api/feedback/{entry['id']}", headers=auth).status_code == 204
    assert client.delete(f"/api/feedback/{entry['id']}", headers=auth).status_code == 404
    assert listing(client).json()["count"] == 0


def test_entries_older_than_twelve_months_are_deleted(tmp_path):
    clock = [dt.datetime(2026, 1, 10, 12, 0, tzinfo=dt.timezone.utc)]
    store = FeedbackStore(tmp_path, alerts(resend_key=""), clock=lambda: clock[0])
    store.add(FeedbackIn(rating=4, comment="Old"), "a", CHROME)
    clock[0] = dt.datetime(2026, 6, 1, tzinfo=dt.timezone.utc)
    store.add(FeedbackIn(rating=5, comment="Newer"), "b", CHROME)

    clock[0] = dt.datetime(2027, 1, 11, tzinfo=dt.timezone.utc)
    assert [e["comment"] for e in store.list()["entries"]] == ["Newer"]
    store.close()
