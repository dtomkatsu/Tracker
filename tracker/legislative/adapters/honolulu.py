"""Honolulu City Council adapter — uses the (undocumented but stable) JSON
endpoints that back the hnldoc.ehawaii.gov bill/resolution browser.

POST /hnldoc/browse/bills.json with:
  {"year": YYYY, "pagination": {"page": N, "sort": "date", "sortDirection": "desc"}}
Returns: {"total": int, "criteria": {...}, "results": [BillRow, ...]}

The same shape exists for /hnldoc/browse/resolutions.json.
"""

from __future__ import annotations

import logging
from datetime import date, datetime
from typing import Any, Iterator

import requests

from tracker.legislative.adapters.base import (
    ActionRecord,
    BillRecord,
    CouncilAdapter,
)

log = logging.getLogger(__name__)

BASE = "https://hnldoc.ehawaii.gov"

_TYPE_LABEL = {
    "BILL": "Bill",
    "RESOLUTION": "Resolution",
}


def _epoch_ms_to_iso(ms: int | None) -> str | None:
    if not ms:
        return None
    try:
        return datetime.utcfromtimestamp(ms / 1000).date().isoformat()
    except (TypeError, ValueError, OSError):
        return None


def _date_obj_to_iso(d: dict | None) -> str | None:
    if not d:
        return None
    try:
        return f"{d['year']:04d}-{d['monthValue']:02d}-{d['dayOfMonth']:02d}"
    except (KeyError, TypeError):
        return None


class HonoluluAdapter(CouncilAdapter):
    council_id = "honolulu"
    PAGE_SIZE = 50  # server-enforced, but pagination.page=-1 returns all

    def __init__(self, session: requests.Session | None = None, timeout: int = 30):
        self.timeout = timeout
        self.session = session or requests.Session()
        self.session.headers.update(
            {
                "User-Agent": (
                    "Tracker/0.1 (+https://github.com/dtomkatsu/Tracker)"
                ),
                "Accept": "application/json",
                "Content-Type": "application/json; charset=utf-8",
                "X-Requested-With": "XMLHttpRequest",
                "Referer": f"{BASE}/hnldoc/browse/c/bills",
            }
        )

    def _fetch_year(self, kind: str, year: int) -> list[dict[str, Any]]:
        url = f"{BASE}/hnldoc/browse/{kind}.json"
        # page=-1 returns everything in one shot; total counts are small (<200/year).
        payload = {
            "year": year,
            "pagination": {"page": -1, "sort": "date", "sortDirection": "desc"},
        }
        r = self.session.post(url, json=payload, timeout=self.timeout)
        r.raise_for_status()
        data = r.json()
        return data.get("results", []) or []

    def _row_to_bill(self, row: dict[str, Any]) -> BillRecord:
        bill_type = _TYPE_LABEL.get(row.get("type"), row.get("type"))
        last_action_iso = _date_obj_to_iso(row.get("lastEventDate"))
        title = (row.get("title") or "").strip() or None
        summary = (row.get("summary") or "").strip() or None
        # Use title + summary as raw_subject for richer classification signal.
        raw_subject = summary
        return BillRecord(
            council=self.council_id,
            bill_number=row.get("displayNumber") or str(row.get("number", "")),
            title=title,
            bill_type=bill_type,
            introducer=(row.get("introducers") or "").strip() or None,
            introduced_date=_epoch_ms_to_iso(row.get("dateIntroduced")),
            status=row.get("lastEventType"),
            last_action=row.get("lastEventDescription"),
            last_action_date=last_action_iso,
            url=f"{BASE}/hnldoc/measure/browse/{row['id']}",
            raw_subject=raw_subject,
        )

    def fetch_bills(self, since: date | None = None) -> Iterator[BillRecord]:
        start_year = since.year if since else date.today().year
        end_year = date.today().year
        for year in range(start_year, end_year + 1):
            for kind in ("bills", "resolutions"):
                try:
                    rows = self._fetch_year(kind, year)
                except requests.HTTPError as e:
                    log.warning("Honolulu %s %s fetch failed: %s", kind, year, e)
                    continue
                for row in rows:
                    bill = self._row_to_bill(row)
                    if since and bill.introduced_date:
                        if bill.introduced_date < since.isoformat():
                            continue
                    yield bill

    def fetch_actions(self, bill_number: str) -> Iterator[ActionRecord]:
        # The browse JSON only exposes lastEvent*; detailed event history would
        # require scraping the per-measure page. Defer; status updates are
        # captured via upsert of the bill row itself.
        return iter(())
