"""Feedback from people using the site.

A rating is the only thing required. A comment is optional. Name, country
and email are given only by someone who asks for a reply, and are used
only to reply. Every entry is deleted after 12 months, and the owner can
delete one sooner.

When a new entry arrives the owner can be sent an email alert (through
Resend). If the person asked for a reply, the alert's reply-to is their
address, so the owner can answer from their inbox.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import hmac
import re
import secrets
import sqlite3
import threading
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

import httpx
from pydantic import BaseModel, ConfigDict, Field, model_validator

RETENTION_DAYS = 365
PER_VISITOR_PER_DAY = 5
ALERTS_PER_DAY = 50
RESEND_URL = "https://api.resend.com/emails"
EMAIL_PATTERN = r"^[^@\s]{1,64}@[^@\s]+\.[^@\s]{2,}$"

SCHEMA = """
CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  rating INTEGER NOT NULL,
  comment TEXT NOT NULL DEFAULT '',
  wants_reply INTEGER NOT NULL DEFAULT 0,
  name TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  app_version TEXT NOT NULL DEFAULT '',
  file_kind TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS alerts (day TEXT PRIMARY KEY, sent INTEGER NOT NULL DEFAULT 0);
"""


class FeedbackIn(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    rating: int = Field(ge=1, le=5)
    comment: str = Field(default="", max_length=2000)
    wants_reply: bool = False
    name: str = Field(default="", max_length=100)
    country: str = Field(default="", max_length=60)
    email: str = Field(default="", max_length=254)
    app_version: str = Field(default="", max_length=20)
    file_kind: Literal["", "delimited", "excel", "parquet", "json"] = ""
    # A field people never see. Bots that fill in every field fill this one too.
    website: str = Field(default="", max_length=200)

    @model_validator(mode="after")
    def contact_only_when_asked(self) -> "FeedbackIn":
        if self.wants_reply:
            if not re.match(EMAIL_PATTERN, self.email):
                raise ValueError("Enter an email address so a reply can reach you.")
        else:
            # Contact details are kept only for someone who asked for a reply.
            self.name = self.country = self.email = ""
        return self


@dataclass
class AlertSettings:
    resend_key: str
    to: str
    sender: str
    site_url: str


def now_utc() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


class FeedbackStore:
    def __init__(
        self,
        data_dir: Path,
        alerts: AlertSettings,
        transport: httpx.BaseTransport | None = None,
        clock=now_utc,
    ):
        data_dir.mkdir(parents=True, exist_ok=True)
        self._db = sqlite3.connect(data_dir / "feedback.db", check_same_thread=False, isolation_level=None)
        self._db.executescript(SCHEMA)
        self._lock = threading.Lock()
        self._clock = clock
        self.alerts = alerts
        self._client = httpx.Client(timeout=15, transport=transport)
        self._day = ""
        self._key = b""
        self._visitors: Counter[bytes] = Counter()

    def _purge(self) -> None:
        cutoff = (self._clock() - dt.timedelta(days=RETENTION_DAYS)).isoformat()
        self._db.execute("DELETE FROM feedback WHERE created_at < ?", (cutoff,))

    def _allowed(self, address: str, user_agent: str) -> bool:
        day = self._clock().date().isoformat()
        if day != self._day:
            self._day, self._key = day, secrets.token_bytes(32)
            self._visitors.clear()
        visitor = hmac.new(self._key, f"{address}|{user_agent}".encode(), hashlib.sha256).digest()
        if self._visitors[visitor] >= PER_VISITOR_PER_DAY:
            return False
        self._visitors[visitor] += 1
        return True

    def add(self, entry: FeedbackIn, address: str, user_agent: str) -> int | None:
        """Saves an entry. Returns its id, or None if it was quietly dropped (a bot, or over the daily limit)."""
        if entry.website:
            return None
        with self._lock:
            if not self._allowed(address, user_agent):
                return None
            self._purge()
            cursor = self._db.execute(
                "INSERT INTO feedback (created_at, rating, comment, wants_reply, name, country, email, app_version, file_kind)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    self._clock().isoformat(timespec="seconds"),
                    entry.rating,
                    entry.comment,
                    int(entry.wants_reply),
                    entry.name,
                    entry.country,
                    entry.email,
                    entry.app_version,
                    entry.file_kind,
                ),
            )
            return int(cursor.lastrowid)

    def list(self) -> dict:
        with self._lock:
            self._purge()
            columns = ["id", "created_at", "rating", "comment", "wants_reply", "name", "country", "email", "app_version", "file_kind"]
            rows = [
                dict(zip(columns, row))
                for row in self._db.execute(f"SELECT {', '.join(columns)} FROM feedback ORDER BY id DESC")
            ]
        for row in rows:
            row["wants_reply"] = bool(row["wants_reply"])
        ratings = [row["rating"] for row in rows]
        return {
            "count": len(rows),
            "average": round(sum(ratings) / len(ratings), 2) if ratings else None,
            "ratings": {str(r): ratings.count(r) for r in range(1, 6)},
            "entries": rows,
            "retention_days": RETENTION_DAYS,
        }

    def delete(self, entry_id: int) -> bool:
        with self._lock:
            return self._db.execute("DELETE FROM feedback WHERE id = ?", (entry_id,)).rowcount > 0

    # ---------- email alerts ----------

    @property
    def alerts_on(self) -> bool:
        return bool(self.alerts.resend_key and self.alerts.to)

    def _take_alert(self) -> bool:
        day = self._clock().date().isoformat()
        with self._lock:
            row = self._db.execute("SELECT sent FROM alerts WHERE day = ?", (day,)).fetchone()
            if row and row[0] >= ALERTS_PER_DAY:
                return False
            self._db.execute(
                "INSERT INTO alerts (day, sent) VALUES (?, 1) ON CONFLICT (day) DO UPDATE SET sent = sent + 1", (day,)
            )
            return True

    def alert_message(self, entry: FeedbackIn) -> dict:
        stars = "★" * entry.rating + "☆" * (5 - entry.rating)
        lines = [f"Rating: {entry.rating} out of 5  {stars}", ""]
        lines += [entry.comment, ""] if entry.comment else ["(No comment.)", ""]
        if entry.wants_reply:
            who = ", ".join(part for part in (entry.name, entry.country) if part)
            lines += [f"They'd like a reply{f' ({who})' if who else ''}: reply to this email to answer them.", ""]
        else:
            lines += ["They didn't ask for a reply.", ""]
        context = ", ".join(part for part in (f"version {entry.app_version}" if entry.app_version else "", entry.file_kind) if part)
        if context:
            lines.append(f"Sent from {context}.")
        if self.alerts.site_url:
            lines.append(f"All feedback: {self.alerts.site_url.rstrip('/')}/#stats")
        message = {
            "from": self.alerts.sender,
            "to": [self.alerts.to],
            "subject": f"Dataset Detective feedback: {entry.rating}/5" + (" (reply wanted)" if entry.wants_reply else ""),
            "text": "\n".join(lines).strip() + "\n",
        }
        if entry.wants_reply:
            message["reply_to"] = entry.email
        return message

    def send_alert(self, entry: FeedbackIn) -> bool:
        """Emails the owner about a new entry. Never raises: feedback is saved whether or not the email goes."""
        if not self.alerts_on or not self._take_alert():
            return False
        try:
            response = self._client.post(
                RESEND_URL,
                headers={
                    "authorization": f"Bearer {self.alerts.resend_key}",
                    "content-type": "application/json",
                    "user-agent": "dataset-detective-feedback/1",
                },
                json=self.alert_message(entry),
            )
            return response.status_code < 300
        except httpx.HTTPError:
            return False

    def close(self) -> None:
        self._client.close()
        self._db.close()
