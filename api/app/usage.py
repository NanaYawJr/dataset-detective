"""Anonymous usage counts.

What is kept on disk: one row per day holding totals (visits, distinct
visitors, files profiled, distinct people who profiled a file) and a count
per file format. Nothing else.

What is never kept on disk: IP addresses, browser details, or anything
derived from them. To estimate how many different people came on a day,
each request is turned into a keyed hash that lives in memory only. The key
is random, never stored, and replaced every day, so a hash cannot be turned
back into an address and cannot be linked from one day to the next.
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
from pathlib import Path

KINDS = ("delimited", "excel", "parquet", "json")

# One person refreshing the page or re-profiling a file should not swamp the totals.
MAX_VISITS_PER_VISITOR = 20
MAX_PROFILES_PER_VISITOR = 100

BOT = re.compile(r"bot|crawl|spider|slurp|preview|monitor|headlesschrome|lighthouse|curl|wget|python-requests", re.I)

SCHEMA = """
CREATE TABLE IF NOT EXISTS daily (
  day TEXT PRIMARY KEY,
  visits INTEGER NOT NULL DEFAULT 0,
  visitors INTEGER NOT NULL DEFAULT 0,
  profiles INTEGER NOT NULL DEFAULT 0,
  users INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS daily_kind (
  day TEXT NOT NULL,
  kind TEXT NOT NULL,
  profiles INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, kind)
);
"""


def today() -> str:
    return dt.datetime.now(dt.timezone.utc).date().isoformat()


def is_bot(user_agent: str) -> bool:
    return not user_agent or bool(BOT.search(user_agent))


class UsageStore:
    def __init__(self, path: Path, clock=today):
        path.parent.mkdir(parents=True, exist_ok=True)
        self._db = sqlite3.connect(path, check_same_thread=False, isolation_level=None)
        self._db.executescript(SCHEMA)
        self._lock = threading.Lock()
        self._clock = clock
        self._day = ""
        self._key = b""
        self._visits: Counter[bytes] = Counter()
        self._profiles: Counter[bytes] = Counter()

    def _roll_over(self, day: str) -> None:
        """A new day: forget yesterday's visitors and the key that made their hashes."""
        if day == self._day:
            return
        self._day = day
        self._key = secrets.token_bytes(32)
        self._visits.clear()
        self._profiles.clear()

    def _visitor(self, address: str, user_agent: str) -> bytes:
        return hmac.new(self._key, f"{address}|{user_agent}".encode(), hashlib.sha256).digest()

    def record(self, event: str, kind: str | None, address: str, user_agent: str) -> bool:
        """Counts one event. Returns False when it was ignored (a bot, or over the daily cap)."""
        if is_bot(user_agent):
            return False
        with self._lock:
            day = self._clock()
            self._roll_over(day)
            visitor = self._visitor(address, user_agent)
            seen, limit, total, distinct = (
                (self._visits, MAX_VISITS_PER_VISITOR, "visits", "visitors")
                if event == "visit"
                else (self._profiles, MAX_PROFILES_PER_VISITOR, "profiles", "users")
            )
            if seen[visitor] >= limit:
                return False
            first = seen[visitor] == 0
            seen[visitor] += 1
            self._db.execute("INSERT OR IGNORE INTO daily (day) VALUES (?)", (day,))
            self._db.execute(
                f"UPDATE daily SET {total} = {total} + 1, {distinct} = {distinct} + ? WHERE day = ?",
                (1 if first else 0, day),
            )
            if event == "profile" and kind in KINDS:
                self._db.execute(
                    "INSERT INTO daily_kind (day, kind, profiles) VALUES (?, ?, 1) "
                    "ON CONFLICT (day, kind) DO UPDATE SET profiles = profiles + 1",
                    (day, kind),
                )
            return True

    def summary(self) -> dict:
        with self._lock:
            days = [
                {"day": day, "visits": visits, "visitors": visitors, "profiles": profiles, "users": users, "kinds": {}}
                for day, visits, visitors, profiles, users in self._db.execute(
                    "SELECT day, visits, visitors, profiles, users FROM daily ORDER BY day DESC"
                )
            ]
            by_day = {d["day"]: d for d in days}
            formats: Counter[str] = Counter()
            for day, kind, profiles in self._db.execute("SELECT day, kind, profiles FROM daily_kind"):
                by_day[day]["kinds"][kind] = profiles
                formats[kind] += profiles
        totals = {key: sum(d[key] for d in days) for key in ("visits", "visitors", "profiles", "users")}
        return {"totals": totals, "formats": dict(formats), "days": days}

    def close(self) -> None:
        self._db.close()
