"""Render site/bills.json from the SQLite store for the static dashboard."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from tracker.legislative.db import DEFAULT_DB, connect, last_completed_run

SITE_DIR = Path(__file__).resolve().parent / "site"


def build(db_path: Path = DEFAULT_DB, site_dir: Path = SITE_DIR) -> Path:
    site_dir.mkdir(parents=True, exist_ok=True)
    out = site_dir / "bills.json"

    with connect(db_path) as conn:
        rows = conn.execute(
            """
            SELECT id, council, bill_number, title, bill_type, introducer,
                   introduced_date, status, last_action, last_action_date,
                   url, raw_subject, subjects, classification_confidence,
                   first_seen, last_updated
            FROM bills
            ORDER BY COALESCE(introduced_date, first_seen) DESC
            """
        ).fetchall()
        last_run = last_completed_run(conn)

    bills = []
    for r in rows:
        d = dict(r)
        try:
            d["subjects"] = json.loads(d.get("subjects") or "[]")
        except json.JSONDecodeError:
            d["subjects"] = []
        bills.append(d)

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "last_scrape": dict(last_run) if last_run else None,
        "subjects": ["tax", "transportation", "food_security", "affordable_housing"],
        "councils": ["honolulu", "maui", "hawaii", "kauai"],
        "bills": bills,
    }
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2))
    print(f"Wrote {out} ({len(bills)} bills)")
    return out


if __name__ == "__main__":
    build()
