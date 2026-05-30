from pathlib import Path

from tracker.legislative.adapters.base import BillRecord
from tracker.legislative.db import connect, init_schema, upsert_bill


def test_upsert_idempotent(tmp_path: Path):
    db = tmp_path / "test.db"
    bill = BillRecord(
        council="honolulu",
        bill_number="BILL040(26)",
        title="RELATING TO REAL PROPERTY TAXATION.",
        bill_type="Bill",
        introducer="Test",
        introduced_date="2026-05-28",
        status="INTRO",
        url="https://example.com/3752",
    )
    with connect(db) as conn:
        init_schema(conn)
        bid, is_new, was_updated = upsert_bill(conn, bill, ["tax"], 0.5)
        assert is_new and not was_updated

        bid2, is_new2, was_updated2 = upsert_bill(conn, bill, ["tax"], 0.5)
        assert bid == bid2 and not is_new2 and not was_updated2

    with connect(db) as conn:
        n = conn.execute("SELECT COUNT(*) FROM bills").fetchone()[0]
        assert n == 1


def test_upsert_detects_status_change(tmp_path: Path):
    db = tmp_path / "test.db"
    bill = BillRecord(
        council="maui",
        bill_number="CC 26-1",
        title="Test bill",
        status="Referred",
        url="https://example.com/1",
    )
    with connect(db) as conn:
        init_schema(conn)
        upsert_bill(conn, bill, [], None)

    bill.status = "Passed First Reading"
    with connect(db) as conn:
        _, is_new, was_updated = upsert_bill(conn, bill, [], None)
        assert not is_new and was_updated
