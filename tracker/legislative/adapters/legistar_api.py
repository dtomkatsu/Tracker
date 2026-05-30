"""Legistar InSite Web API adapter.

Used for tenants where Granicus has provisioned the public InSite API
(confirmed working for Maui = `mauicounty`; not provisioned for Hawaii County
or Kauai as of 2026-05-29).

API docs: https://webapi.legistar.com/Help
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

API_BASE = "https://webapi.legistar.com/v1"
WEB_BASE = "https://{tenant}.legistar.com"

# Excluded matter types — administrative noise that's not a substantive bill/resolution.
# Tune as needed; better to over-include and filter on the dashboard than to silently drop.
_EXCLUDED_TYPES = {
    "Comments from the Public",
    "Communications",
    "Minutes",
    "Public Hearing Notice",
}


def _to_iso_date(s: str | None) -> str | None:
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "")).date().isoformat()
    except (ValueError, TypeError):
        return s


class LegistarApiAdapter(CouncilAdapter):
    def __init__(
        self,
        council_id: str,
        tenant: str,
        page_size: int = 200,
        timeout: int = 30,
        session: requests.Session | None = None,
    ):
        self.council_id = council_id
        self.tenant = tenant
        self.page_size = page_size
        self.timeout = timeout
        self.session = session or requests.Session()
        self.session.headers.setdefault("Accept", "application/json")
        self.session.headers.setdefault(
            "User-Agent", "Tracker/0.1 (+https://github.com/dtomkatsu/Tracker)"
        )

    def _matter_url(self, matter_id: int) -> str:
        # Gateway.aspx?M=L&ID={MatterId} is the public legislation permalink.
        # The LegislationDetail.aspx?ID=&GUID= form returns "Invalid parameters!"
        # on this tenant, so it must not be used.
        return f"{WEB_BASE.format(tenant=self.tenant)}/Gateway.aspx?M=L&ID={matter_id}"

    def _to_bill(self, m: dict[str, Any]) -> BillRecord:
        return BillRecord(
            council=self.council_id,
            bill_number=(m.get("MatterFile") or "").strip(),
            title=(m.get("MatterTitle") or m.get("MatterName") or "").strip() or None,
            bill_type=m.get("MatterTypeName"),
            introducer=m.get("MatterRequester"),
            introduced_date=_to_iso_date(m.get("MatterIntroDate")),
            status=m.get("MatterStatusName"),
            last_action=None,
            last_action_date=None,
            url=self._matter_url(m["MatterId"]),
            raw_subject=m.get("MatterBodyName"),
        )

    def fetch_bills(self, since: date | None = None) -> Iterator[BillRecord]:
        skip = 0
        url = f"{API_BASE}/{self.tenant}/Matters"
        params: dict[str, Any] = {
            "$top": self.page_size,
            "$orderby": "MatterIntroDate desc",
        }
        if since is not None:
            params["$filter"] = (
                f"MatterIntroDate gt datetime'{since.isoformat()}'"
            )
        while True:
            params["$skip"] = skip
            r = self.session.get(url, params=params, timeout=self.timeout)
            r.raise_for_status()
            page = r.json()
            if not page:
                return
            for m in page:
                if m.get("MatterRestrictViewViaWeb"):
                    continue
                if m.get("MatterTypeName") in _EXCLUDED_TYPES:
                    continue
                if not m.get("MatterFile"):
                    continue
                yield self._to_bill(m)
            if len(page) < self.page_size:
                return
            skip += self.page_size

    def fetch_actions(self, bill_number: str) -> Iterator[ActionRecord]:
        """Fetch action history for a bill via MatterHistories endpoint.

        Two-step: look up MatterId by MatterFile, then fetch histories.
        """
        url = f"{API_BASE}/{self.tenant}/Matters"
        params = {
            "$filter": f"MatterFile eq '{bill_number}'",
            "$top": 1,
            "$select": "MatterId",
        }
        try:
            r = self.session.get(url, params=params, timeout=self.timeout)
            r.raise_for_status()
            matches = r.json()
            if not matches:
                return
            matter_id = matches[0]["MatterId"]
            hist_url = (
                f"{API_BASE}/{self.tenant}/Matters/{matter_id}/Histories"
            )
            hr = self.session.get(hist_url, timeout=self.timeout)
            hr.raise_for_status()
            for h in hr.json():
                action_date = _to_iso_date(h.get("MatterHistoryActionDate"))
                action = h.get("MatterHistoryActionName") or h.get("MatterHistoryActionText")
                if not action_date or not action:
                    continue
                yield ActionRecord(
                    council=self.council_id,
                    bill_number=bill_number,
                    action_date=action_date,
                    action=action,
                    committee=h.get("MatterHistoryActionBodyName"),
                )
        except requests.HTTPError as e:
            log.warning("Legistar API actions fetch failed for %s: %s", bill_number, e)
