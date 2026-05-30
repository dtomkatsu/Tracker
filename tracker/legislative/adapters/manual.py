"""Manual-entry adapter — reads bills from a hand-maintained JSON file.

Used for councils where no scrapable data source is currently available:
Hawaii County and Kauai both have inactive Legistar deployments
(`hawaiicounty.legistar.com`, `kauai.legistar.com` return "Invalid parameters!"
for every request) and their `*.gov` council pages are behind Akamai WAFs
that block server-side fetches.

Until a viable scraping path opens up, drop entries into
`data/manual/{council}.json` — each entry is a BillRecord JSON object.
Example:

    {
      "bills": [
        {
          "bill_number": "Bill 123 (2026)",
          "title": "Property tax exemption tier expansion",
          "bill_type": "Bill",
          "introducer": "Council Member Smith",
          "introduced_date": "2026-05-01",
          "status": "First Reading",
          "url": "https://records.hawaiicounty.gov/...",
          "raw_subject": "Real property tax"
        }
      ]
    }

Edit the file, run `python -m tracker.legislative scrape --council hawaii`,
and entries are upserted normally — including subject classification.
"""

from __future__ import annotations

import json
import logging
from datetime import date
from pathlib import Path
from typing import Iterator

from tracker.legislative.adapters.base import (
    ActionRecord,
    BillRecord,
    CouncilAdapter,
)

log = logging.getLogger(__name__)

MANUAL_DIR = Path(__file__).resolve().parents[3] / "data" / "manual"


class ManualAdapter(CouncilAdapter):
    def __init__(self, council_id: str, manual_dir: Path = MANUAL_DIR):
        self.council_id = council_id
        self.manual_path = manual_dir / f"{council_id}.json"

    def fetch_bills(self, since: date | None = None) -> Iterator[BillRecord]:
        if not self.manual_path.exists():
            log.info(
                "No manual entries for %s (expected %s)",
                self.council_id, self.manual_path,
            )
            return
        try:
            data = json.loads(self.manual_path.read_text())
        except json.JSONDecodeError as e:
            log.error("Invalid JSON in %s: %s", self.manual_path, e)
            return
        for raw in data.get("bills", []):
            raw.setdefault("council", self.council_id)
            try:
                bill = BillRecord(**raw)
            except Exception as e:
                log.warning("Skipping malformed manual entry: %s — %s", raw, e)
                continue
            if since and bill.introduced_date:
                if bill.introduced_date < since.isoformat():
                    continue
            yield bill

    def fetch_actions(self, bill_number: str) -> Iterator[ActionRecord]:
        return iter(())
