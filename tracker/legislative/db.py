import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

from tracker.legislative.adapters.base import ActionRecord, BillRecord

DEFAULT_DB = Path(__file__).resolve().parents[2] / "data" / "bills.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS bills (
  id INTEGER PRIMARY KEY,
  council TEXT NOT NULL,
  bill_number TEXT NOT NULL,
  title TEXT,
  bill_type TEXT,
  introducer TEXT,
  introduced_date TEXT,
  status TEXT,
  last_action TEXT,
  last_action_date TEXT,
  url TEXT,
  raw_subject TEXT,
  subjects TEXT NOT NULL DEFAULT '[]',
  classification_confidence REAL,
  first_seen TEXT NOT NULL,
  last_updated TEXT NOT NULL,
  UNIQUE(council, bill_number)
);

CREATE INDEX IF NOT EXISTS idx_bills_council ON bills(council);
CREATE INDEX IF NOT EXISTS idx_bills_introduced_date ON bills(introduced_date);

CREATE TABLE IF NOT EXISTS bill_actions (
  id INTEGER PRIMARY KEY,
  bill_id INTEGER NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  action_date TEXT,
  action TEXT,
  committee TEXT,
  UNIQUE(bill_id, action_date, action)
);

CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  council TEXT,
  bills_seen INTEGER DEFAULT 0,
  bills_new INTEGER DEFAULT 0,
  bills_updated INTEGER DEFAULT 0,
  errors TEXT
);
"""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


@contextmanager
def connect(db_path: Path = DEFAULT_DB):
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA)


def upsert_bill(
    conn: sqlite3.Connection,
    bill: BillRecord,
    subjects: list[str],
    confidence: float | None,
) -> tuple[int, bool, bool]:
    """Insert or update a bill. Returns (bill_id, is_new, was_updated)."""
    now = _now()
    subjects_json = json.dumps(subjects)

    existing = conn.execute(
        "SELECT id, status, last_action, last_action_date, title, url, raw_subject "
        "FROM bills WHERE council = ? AND bill_number = ?",
        (bill.council, bill.bill_number),
    ).fetchone()

    if existing is None:
        cur = conn.execute(
            """
            INSERT INTO bills (
              council, bill_number, title, bill_type, introducer, introduced_date,
              status, last_action, last_action_date, url,
              raw_subject, subjects, classification_confidence,
              first_seen, last_updated
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                bill.council, bill.bill_number, bill.title, bill.bill_type,
                bill.introducer, bill.introduced_date, bill.status,
                bill.last_action, bill.last_action_date, bill.url,
                bill.raw_subject, subjects_json, confidence, now, now,
            ),
        )
        return cur.lastrowid, True, False

    changed = (
        existing["status"] != bill.status
        or existing["last_action"] != bill.last_action
        or existing["last_action_date"] != bill.last_action_date
        or existing["title"] != bill.title
        or existing["url"] != bill.url
        or existing["raw_subject"] != bill.raw_subject
    )
    if changed:
        conn.execute(
            """
            UPDATE bills SET
              title = ?, bill_type = ?, introducer = ?, status = ?,
              last_action = ?, last_action_date = ?, url = ?,
              raw_subject = ?, subjects = ?, classification_confidence = ?,
              last_updated = ?
            WHERE id = ?
            """,
            (
                bill.title, bill.bill_type, bill.introducer, bill.status,
                bill.last_action, bill.last_action_date, bill.url,
                bill.raw_subject, subjects_json, confidence,
                now, existing["id"],
            ),
        )
    return existing["id"], False, changed


def upsert_actions(
    conn: sqlite3.Connection, bill_id: int, actions: Iterable[ActionRecord]
) -> int:
    n = 0
    for a in actions:
        cur = conn.execute(
            """
            INSERT OR IGNORE INTO bill_actions (bill_id, action_date, action, committee)
            VALUES (?, ?, ?, ?)
            """,
            (bill_id, a.action_date, a.action, a.committee),
        )
        n += cur.rowcount or 0
    return n


def start_run(conn: sqlite3.Connection, council: str | None) -> int:
    cur = conn.execute(
        "INSERT INTO runs (started_at, council) VALUES (?, ?)",
        (_now(), council),
    )
    return cur.lastrowid


def finish_run(
    conn: sqlite3.Connection,
    run_id: int,
    seen: int,
    new: int,
    updated: int,
    errors: list[str] | None = None,
) -> None:
    conn.execute(
        """
        UPDATE runs SET completed_at = ?, bills_seen = ?, bills_new = ?,
                       bills_updated = ?, errors = ?
        WHERE id = ?
        """,
        (
            _now(), seen, new, updated,
            json.dumps(errors) if errors else None,
            run_id,
        ),
    )


def last_completed_run(
    conn: sqlite3.Connection, council: str | None = None
) -> sqlite3.Row | None:
    if council:
        return conn.execute(
            "SELECT * FROM runs WHERE council = ? AND completed_at IS NOT NULL "
            "ORDER BY completed_at DESC LIMIT 1",
            (council,),
        ).fetchone()
    return conn.execute(
        "SELECT * FROM runs WHERE completed_at IS NOT NULL "
        "ORDER BY completed_at DESC LIMIT 1"
    ).fetchone()
