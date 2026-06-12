"""bill_changes logging in upsert_bill + Atom feed generation."""

from pathlib import Path

from tracker.legislative.adapters.base import BillRecord
from tracker.legislative.db import connect, init_schema, upsert_bill
from tracker.legislative.feeds import bill_slug, build_feeds


def _bill(**kw):
    base = dict(
        council="kauai", bill_number="Bill 2995",
        title="A BILL FOR AN ORDINANCE RELATING TO REAL PROPERTY TAX",
        bill_type="Bill", url="http://example.com/2995",
        status="In committee", last_action="On agenda 2026-05-27",
        last_action_date="2026-05-27", raw_subject="Summary text.",
    )
    base.update(kw)
    return BillRecord(**base)


def _setup_db(tmp_path: Path) -> Path:
    db = tmp_path / "t.db"
    with connect(db) as conn:
        init_schema(conn)
    return db


def test_upsert_logs_new_and_status_change(tmp_path):
    db = _setup_db(tmp_path)
    with connect(db) as conn:
        upsert_bill(conn, _bill(), [], None)
        rows = conn.execute("SELECT * FROM bill_changes").fetchall()
        assert len(rows) == 1 and rows[0]["kind"] == "new"
        assert rows[0]["new_status"] == "In committee"

        # Status moves -> an 'update' row with old -> new.
        upsert_bill(conn, _bill(status="Passed 1st reading",
                                last_action="Passed first reading.",
                                last_action_date="2026-06-03"), [], None)
        rows = conn.execute("SELECT * FROM bill_changes ORDER BY id").fetchall()
        assert len(rows) == 2
        assert rows[1]["kind"] == "update"
        assert rows[1]["old_status"] == "In committee"
        assert rows[1]["new_status"] == "Passed 1st reading"


def test_upsert_title_only_change_makes_no_feed_entry(tmp_path):
    db = _setup_db(tmp_path)
    with connect(db) as conn:
        upsert_bill(conn, _bill(), [], None)
        upsert_bill(conn, _bill(title="A LONGER, BETTER TITLE RELATING TO REAL PROPERTY TAX"), [], None)
        rows = conn.execute("SELECT kind FROM bill_changes").fetchall()
        assert [r["kind"] for r in rows] == ["new"]  # update logged nothing


def test_bill_slug():
    assert bill_slug("honolulu", "BILL040(26)") == "honolulu-bill040-26"
    assert bill_slug("kauai", "Resolution 2026-08") == "kauai-resolution-2026-08"
    assert bill_slug("maui", "Bill 153  (2024)") == bill_slug("maui", "Bill 153 (2024)")


def test_build_feeds_writes_expected_files(tmp_path):
    db = _setup_db(tmp_path)
    with connect(db) as conn:
        upsert_bill(conn, _bill(), ["tax"], 0.9)
        upsert_bill(conn, _bill(status="Passed 1st reading"), ["tax"], 0.9)

    site = tmp_path / "site"
    build_feeds(db_path=db, site_dir=site)

    allxml = (site / "feeds" / "all.xml").read_text()
    assert "In committee → Passed 1st reading" in allxml
    assert "<feed" in allxml and "atom" in allxml.lower()

    per_bill = site / "feeds" / "bill" / "kauai-bill-2995.xml"
    assert per_bill.exists()
    content = per_bill.read_text()
    assert "New: Bill 2995" in content and "Passed 1st reading" in content

    subj = (site / "feeds" / "subject-tax.xml").read_text()
    assert "Bill 2995" in subj
    # Unrelated subject feed exists but has no entries for this bill.
    other = (site / "feeds" / "subject-transportation.xml").read_text()
    assert "Bill 2995" not in other

    # Deterministic: a rebuild rewrites nothing.
    assert build_feeds(db_path=db, site_dir=site) == 0
