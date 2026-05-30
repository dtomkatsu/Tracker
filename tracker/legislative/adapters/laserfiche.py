"""Hawaii County adapter — Laserfiche "Council Records System" metadata,
enriched with bill titles from Granicus agendas.

Hawaii County's authoritative legislative record is the Laserfiche WebLink
portal at records.hawaiicounty.gov. Each bill/resolution/ordinance is a
document carrying a structured "Bill/Resolution" template: type, number,
introducer, referring committee, a dated action history, status, reading
dates, and vote tallies. This is far richer than the meeting agendas — but the
template has NO title/subject field (the title lives only in the document PDF,
which is a scanned image). So we read the rich metadata from Laserfiche and
borrow the descriptive title from the Granicus agenda for the same bill number,
which is what makes subject classification possible.

Laserfiche WebLink 9 is ASP.NET WebForms with no API and a CookieCheck gate, so
we drive it with a headless browser (same as Granicus).
"""

from __future__ import annotations

import logging
import re
from datetime import date, datetime
from typing import Iterator

from tracker.legislative.adapters.base import (
    ActionRecord,
    BillRecord,
    CouncilAdapter,
)
from tracker.legislative.adapters.granicus import GranicusAdapter

log = logging.getLogger(__name__)

_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)
_BASE = "https://records.hawaiicounty.gov/WebLink"

# Top-level Laserfiche folders (stable folder ids in the Council Records tree).
_CATEGORY_STARTID = {"Bill": 50, "Resolution": 41, "Ordinance": 47}
_TYPE_LABEL = {"BIL": "Bill", "RES": "Resolution", "ORD": "Ordinance"}

# Document name, e.g. "BIL 001 Draft 01 2024-2026" or "RES 12 Draft 02 ...".
_DOCNAME_RE = re.compile(r"\b(BIL|RES|ORD)\s+(\d+)\s+Draft\s+(\d+)", re.I)
_DATE_RE = re.compile(r"(\d{1,2})/(\d{1,2})/(\d{2,4})")


def _norm_key(type_label: str, number: str) -> str:
    """Canonical bill key for joining with Granicus, e.g. 'Bill 1'."""
    return f"{type_label} {int(number)}"


def _iso_from_mdy(s: str) -> str | None:
    m = _DATE_RE.search(s or "")
    if not m:
        return None
    mo, d, y = m.groups()
    y = int(y)
    if y < 100:
        y += 2000
    try:
        return date(y, int(mo), int(d)).isoformat()
    except ValueError:
        return None


class HawaiiCountyAdapter(CouncilAdapter):
    council_id = "hawaii"

    def __init__(self, term_year: int | None = None):
        self.term_year = term_year or date.today().year

    # ---- Laserfiche navigation --------------------------------------------

    def _open_session(self, page) -> None:
        page.goto(f"{_BASE}/Browse.aspx?startid=50&dbid=0", wait_until="networkidle", timeout=45000)

    def _current_term_folder(self, page, startid: int) -> str | None:
        """Folder URL for the current council term (e.g. '2024-2026'). Year
        folders are paginated oldest-first, so the current term is on the LAST
        page — always jump there before matching."""
        page.goto(f"{_BASE}/Browse.aspx?startid={startid}&dbid=0", wait_until="networkidle", timeout=45000)
        last = page.query_selector("a:has-text('Last')")
        if last:
            last.click()
            page.wait_for_load_state("networkidle", timeout=10000)
            page.wait_for_timeout(1000)

        links = page.eval_on_selector_all(
            "a",
            "els => els.map(e => ({t:(e.innerText||'').trim(), h:e.href})).filter(x => /\\/fol\\//.test(x.h) && x.t)",
        )
        yr = str(self.term_year)
        # Prefer a folder whose label includes the current year (covers ranges
        # like "2024-2026"); else the lexically greatest year-bearing label.
        cands = [l for l in links if yr in l["t"]]
        if cands:
            return max(cands, key=lambda l: l["t"])["h"]
        ranges = [l for l in links if re.search(r"\d{4}", l["t"])]
        return max(ranges, key=lambda l: l["t"])["h"] if ranges else None

    def _list_docs(self, page, folder_url: str) -> list[tuple[str, str]]:
        """Return [(doc_id, name)] for documents directly in a folder."""
        page.goto(folder_url, wait_until="networkidle", timeout=45000)
        page.wait_for_timeout(600)
        items = page.eval_on_selector_all(
            "a",
            r"""els => els
                .map(e => ({t:(e.innerText||'').trim().replace(/\s+/g,' '), h:e.href}))
                .filter(x => /\/0\/doc\/\d+/.test(x.h) && x.t)""",
        )
        out = []
        for it in items:
            m = re.search(r"/0/doc/(\d+)", it["h"])
            if m:
                out.append((m.group(1), it["t"]))
        return out

    def _metadata(self, page, doc_id: str) -> dict[str, str]:
        page.goto(f"{_BASE}/DocView.aspx?id={doc_id}&dbid=0&cr=1", wait_until="networkidle", timeout=45000)
        page.wait_for_timeout(400)
        pairs = page.evaluate(
            r"""() => {
              const scope = document.querySelector('.TemplateFields') || document;
              const names = [...scope.querySelectorAll('.FieldDisplayName')].map(e => (e.innerText||'').trim());
              const vals  = [...scope.querySelectorAll('.FieldDisplayValue')].map(e => (e.innerText||'').trim().replace(/\s+/g,' '));
              const out = {};
              for (let i = 0; i < Math.min(names.length, vals.length); i++) {
                if (names[i]) out[names[i]] = vals[i];
              }
              return out;
            }"""
        )
        return pairs or {}

    # ---- record assembly ---------------------------------------------------

    def _build_record(self, meta: dict[str, str], doc_id: str) -> BillRecord | None:
        type_code = (meta.get("Bill/Resolution - Type") or "").strip().upper()
        type_label = _TYPE_LABEL.get(type_code)
        number = (meta.get("Bill/Resolution") or "").strip()
        if not type_label or not number.isdigit():
            return None

        # Latest action = highest-numbered non-empty "Action N" field.
        actions = sorted(
            ((int(k.split()[1]), v) for k, v in meta.items()
             if re.fullmatch(r"Action \d+", k) and v),
            key=lambda x: x[0],
        )
        last_action = actions[-1][1] if actions else None
        last_action_date = _iso_from_mdy(last_action) if last_action else None

        status = (meta.get("Status") or "").strip() or None
        if not status and last_action:
            la = last_action.lower()
            if "second" in la and "final" in la:
                status = "Passed Second Reading"
            elif "first reading" in la:
                status = "Passed First Reading"
            elif "postponed" in la:
                status = "Postponed"

        intro_date = _iso_from_mdy(meta.get("Reading Date", "")) or (
            _iso_from_mdy(actions[0][1]) if actions else None
        )

        return BillRecord(
            council=self.council_id,
            bill_number=_norm_key(type_label, number),
            title=None,  # filled from Granicus below
            bill_type=type_label,
            introducer=(meta.get("Introducer") or "").strip() or None,
            introduced_date=intro_date,
            status=status,
            last_action=last_action,
            last_action_date=last_action_date,
            url=f"{_BASE}/DocView.aspx?id={doc_id}&dbid=0",
            raw_subject=(meta.get("Referred To") or "").strip() or None,
        )

    def _active_from_granicus(self, since: date | None) -> dict[str, BillRecord]:
        """Currently-active bills (on recent agendas) keyed by bill number.
        Granicus is the source of the 'being considered' set and the titles."""
        active: dict[str, BillRecord] = {}
        try:
            gran = GranicusAdapter(
                council_id="hawaii", host="hawaiicounty.granicus.com",
                view_ids=[1, 2], mode="pdf", max_meetings=30,
            )
            for b in gran.fetch_bills(since=since):
                active[b.bill_number] = b
        except Exception as e:
            log.warning("Granicus active-set fetch failed: %s", e)
        return active

    def _doc_index(self, page) -> dict[str, str]:
        """{bill_number: doc_id} for the latest draft of each current-term
        bill/resolution/ordinance — a cheap listing, no per-doc fetch."""
        index: dict[str, tuple[str, int]] = {}
        for type_label, startid in _CATEGORY_STARTID.items():
            try:
                folder = self._current_term_folder(page, startid)
            except Exception as e:
                log.warning("hawaii term folder (%s) failed: %s", type_label, e)
                continue
            if not folder:
                continue
            for doc_id, name in self._list_docs(page, folder):
                m = _DOCNAME_RE.search(name)
                if not m:
                    continue
                code, num, draft = m.group(1).upper(), m.group(2), int(m.group(3))
                key = _norm_key(_TYPE_LABEL.get(code, code), num)
                if key not in index or draft > index[key][1]:
                    index[key] = (doc_id, draft)
        return {k: v[0] for k, v in index.items()}

    # ---- public API --------------------------------------------------------

    def fetch_bills(self, since: date | None = None) -> Iterator[BillRecord]:
        from playwright.sync_api import sync_playwright

        # 1. Active set + titles from Granicus agendas.
        active = self._active_from_granicus(since)
        if not active:
            return

        # 2. Enrich each active bill with Laserfiche metadata (introducer,
        #    precise status, dated action history) where the bill is filed.
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            ctx = browser.new_context(user_agent=_UA, ignore_https_errors=True)
            page = ctx.new_page()
            try:
                self._open_session(page)
                index = self._doc_index(page)
                if not index:
                    # Laserfiche unreachable/blocked — fall back to Granicus
                    # data so Hawaii County still tracks (just less metadata).
                    log.warning("Laserfiche index empty; using Granicus-only data for hawaii")
                    yield from active.values()
                    return
                for number, gbill in active.items():
                    doc_id = index.get(number)
                    if not doc_id:
                        yield gbill  # on agenda but not yet filed in Laserfiche
                        continue
                    page.wait_for_timeout(500)  # be polite to the records server
                    try:
                        meta = self._metadata(page, doc_id)
                        rec = self._build_record(meta, doc_id)
                    except Exception as e:
                        log.warning("hawaii metadata (%s) failed: %s", number, e)
                        rec = None
                    if rec is None:
                        yield gbill
                        continue
                    # Laserfiche is authoritative for metadata; Granicus for title.
                    rec.title = gbill.title
                    rec.raw_subject = gbill.title
                    yield rec
            finally:
                browser.close()

    def fetch_actions(self, bill_number: str) -> Iterator[ActionRecord]:
        return iter(())
