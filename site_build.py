"""Render site/bills.json from the SQLite store for the static dashboard."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from tracker.legislative.db import DEFAULT_DB, connect, last_completed_run
from tracker.legislative.feeds import build_feeds

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
        # Per-bill action history for the dashboard's expandable timeline.
        # Newest action first; the front-end leads with [0] as the latest.
        action_rows = conn.execute(
            """
            SELECT bill_id, action_date, action, committee
            FROM bill_actions
            ORDER BY bill_id, action_date DESC, id DESC
            """
        ).fetchall()

    actions_by_bill: dict[int, list[dict]] = {}
    for a in action_rows:
        actions_by_bill.setdefault(a["bill_id"], []).append(
            {"date": a["action_date"], "action": a["action"], "committee": a["committee"]}
        )

    bills = []
    for r in rows:
        d = dict(r)
        try:
            d["subjects"] = json.loads(d.get("subjects") or "[]")
        except json.JSONDecodeError:
            d["subjects"] = []
        acts = actions_by_bill.get(d["id"])
        if acts:
            d["actions"] = acts
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
    build_feeds(db_path=db_path, site_dir=site_dir)
    return out


if __name__ == "__main__":
    build()
