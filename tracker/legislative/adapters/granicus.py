"""Granicus adapter — for councils whose only structured source is their
Granicus meeting agendas (Hawaii County and Kauai).

Neither council has a usable bill API: their Legistar tenants are unprovisioned
and their .gov sites are behind an Akamai WAF that blocks headless requests.
But both publish meeting agendas on Granicus, and bills/resolutions appear in
the agenda text with their numbers, titles, and reading stage. We drive a real
headless browser (the WAF/Granicus tolerate Chromium far better than bare HTTP)
to read each recent agenda and extract legislation.

Two agenda render modes:
  - "html": AgendaViewer.php returns an HTML page (Kauai)
  - "pdf":  AgendaViewer.php returns a generated PDF (Hawaii County)

Both are text-extractable. We list recent meetings from ViewPublisher.php,
read each agenda, and pull out Bill/Resolution items. A bill can appear across
several meetings as it advances; we keep the most recent appearance (its
section heading gives the latest reading stage).
"""

from __future__ import annotations

import io
import logging
import re
from datetime import date, datetime
from typing import Iterator

from tracker.legislative.adapters.base import (
    ActionRecord,
    BillRecord,
    CouncilAdapter,
)

log = logging.getLogger(__name__)

_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)

# A meeting row on ViewPublisher carries a date like "May 27, 2026" and an
# AgendaViewer link. We pair each agenda link with the nearest date on its row.
_AGENDA_RE = re.compile(r"AgendaViewer\.php\?[^\"']*\b(?:clip_id|event_id)=\d+", re.I)
_DATE_PATTERNS = [
    re.compile(r"[A-Z][a-z]{2,8}\s+\d{1,2},\s+\d{4}"),          # May 27, 2026
    re.compile(r"\d{1,2}/\d{1,2}/\d{4}"),                         # 05/27/2026
]

# Legislation references inside agenda text.
_BILL_RE = re.compile(
    r"\b(Bill|Resolution|Reso)\s+(?:No\.?\s*)?(\d{2,4}(?:-\d{1,4})?)\b", re.I
)
# Section headers that indicate a reading stage / status.
_STAGE_RE = re.compile(
    r"(BILLS?\s+FOR\s+FIRST\s+READING"
    r"|BILLS?\s+FOR\s+SECOND\s+(?:AND\s+FINAL\s+)?READING"
    r"|BILLS?\s+FOR\s+SECOND\s+READING"
    r"|RESOLUTION[S]?\b"
    r"|BILLS?\b"
    r"|COMMITTEE\s+REPORTS?"
    r"|UNFINISHED\s+BUSINESS)",
    re.I,
)
_STAGE_LABELS = {
    "first reading": "First Reading",
    "second": "Second Reading",
    "committee": "In Committee",
    "unfinished": "Unfinished Business",
}


def _stage_label(header: str) -> str | None:
    h = header.lower()
    if "first reading" in h:
        return "First Reading"
    if "second" in h:
        return "Second Reading"
    if "committee" in h:
        return "In Committee"
    if "unfinished" in h:
        return "Unfinished Business"
    return None


def _parse_date(s: str) -> str | None:
    s = s.strip()
    for fmt in ("%B %d, %Y", "%b %d, %Y", "%m/%d/%Y"):
        try:
            return datetime.strptime(s, fmt).date().isoformat()
        except ValueError:
            continue
    return None


def _clean(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


_TITLE_KEYWORDS = re.compile(
    r"\b(ORDINANCE|RESOLUTION|BILL|AMEND|RELATING|ESTABLISH|APPROV|AUTHORIZ"
    r"|PROVID|REPEAL|CHARTER|BUDGET|APPROPRIAT|ADOPT|DESIGNAT|GRANT|CREAT)\w*",
    re.I,
)


def _looks_like_title(t: str) -> bool:
    """A real agenda item title vs. an incidental cross-reference."""
    if not t or len(t) < 15:
        return False
    if len(t.split()) < 4:
        return False
    return bool(_TITLE_KEYWORDS.search(t))


class GranicusAdapter(CouncilAdapter):
    def __init__(
        self,
        council_id: str,
        host: str,
        view_ids: list[int],
        mode: str = "html",
        max_meetings: int = 60,
    ):
        self.council_id = council_id
        self.host = host
        self.view_ids = view_ids
        self.mode = mode
        self.max_meetings = max_meetings

    # ---- meeting discovery -------------------------------------------------

    def _list_meetings(self, page, view_id: int) -> list[tuple[str, str]]:
        """Return [(iso_date, agenda_url)] for one publisher view.

        Layout varies by tenant (Hawaii County uses table rows, Kauai doesn't),
        so for each agenda link we read the nearest sensible container for its
        meeting date rather than assuming a <tr>.
        """
        url = f"https://{self.host}/ViewPublisher.php?view_id={view_id}"
        page.goto(url, wait_until="domcontentloaded", timeout=45000)
        try:
            page.wait_for_load_state("networkidle", timeout=8000)
        except Exception:
            page.wait_for_timeout(1500)
        rows = page.eval_on_selector_all(
            "a",
            """els => els
                .filter(a => /AgendaViewer\\.php/.test(a.href))
                .map(a => {
                    const box = a.closest('tr, li, .listingRow, .row') || a.parentElement?.parentElement || a.parentElement;
                    return { href: a.href, row: (box ? box.innerText : '') || '' };
                })""",
        )
        out: list[tuple[str, str]] = []
        seen: set[str] = set()
        for r in rows:
            if not _AGENDA_RE.search(r["href"]) or r["href"] in seen:
                continue
            seen.add(r["href"])
            iso = None
            for pat in _DATE_PATTERNS:
                m = pat.search(r["row"])
                if m:
                    iso = _parse_date(m.group(0))
                    if iso:
                        break
            out.append((iso or "", r["href"]))
        return out

    # ---- agenda fetch ------------------------------------------------------

    def _agenda_text(self, ctx, page, agenda_url: str) -> str:
        if self.mode == "pdf":
            from pypdf import PdfReader

            resp = ctx.request.get(agenda_url, timeout=45000)
            body = resp.body()
            if body[:4] != b"%PDF":
                return ""
            reader = PdfReader(io.BytesIO(body))
            return "\n".join((pg.extract_text() or "") for pg in reader.pages)
        # html mode
        page.goto(agenda_url, wait_until="domcontentloaded", timeout=45000)
        page.wait_for_timeout(800)
        return page.inner_text("body")

    # ---- agenda parsing ----------------------------------------------------

    def _parse_agenda(
        self, text: str, meeting_date: str, agenda_url: str
    ) -> list[dict]:
        """Yield mention dicts for bill numbers whose following text reads like
        a real legislative title. Incidental cross-references (a number listed
        in a sentence, a minutes line, etc.) are skipped — their trailing text
        won't pass _looks_like_title."""
        flat = _clean(text)
        out: list[dict] = []
        for m in _BILL_RE.finditer(flat):
            kind = m.group(1).lower()
            num = m.group(2)
            bill_type = "Resolution" if kind.startswith("res") else "Bill"
            bill_number = f"{bill_type} {num}"

            # Title window: text up to the next bill reference, capped. Do NOT
            # split on periods — legal titles are full of "NO.", "SEC.", etc.
            tail = _BILL_RE.split(flat[m.end(): m.end() + 300])[0]
            title = _clean(tail).lstrip("-–—:.,) ")
            title = re.sub(r"^\(Draft\s+\d+\)\s*", "", title, flags=re.I).strip()
            title = title[:220].rstrip()
            if not _looks_like_title(title):
                continue

            # Status from the nearest preceding stage header.
            stage = None
            last_hdr = None
            for last_hdr in _STAGE_RE.finditer(flat[: m.start()]):
                pass
            if last_hdr:
                stage = _stage_label(last_hdr.group(0))

            out.append({
                "bill_number": bill_number,
                "bill_type": bill_type,
                "title": title,
                "stage": stage,
                "date": meeting_date,
                "url": agenda_url,
            })
        return out

    # ---- public API --------------------------------------------------------

    def fetch_bills(self, since: date | None = None) -> Iterator[BillRecord]:
        from playwright.sync_api import sync_playwright

        # Per bill: keep the longest (best) title ever seen, plus the latest
        # meeting date and the stage from that latest meeting.
        merged: dict[str, dict] = {}
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            ctx = browser.new_context(user_agent=_UA, ignore_https_errors=True)
            page = ctx.new_page()
            try:
                meetings: list[tuple[str, str]] = []
                for vid in self.view_ids:
                    try:
                        meetings.extend(self._list_meetings(page, vid))
                    except Exception as e:
                        log.warning("%s view %s listing failed: %s", self.council_id, vid, e)

                # Most recent first; honor the since window and the meeting cap.
                meetings = [m for m in meetings if not (since and m[0] and m[0] < since.isoformat())]
                meetings.sort(key=lambda m: m[0], reverse=True)
                meetings = meetings[: self.max_meetings]

                for mdate, agenda_url in meetings:
                    try:
                        text = self._agenda_text(ctx, page, agenda_url)
                    except Exception as e:
                        log.warning("%s agenda fetch failed (%s): %s", self.council_id, agenda_url, e)
                        continue
                    for men in self._parse_agenda(text, mdate, agenda_url):
                        key = men["bill_number"]
                        cur = merged.get(key)
                        if cur is None:
                            merged[key] = men
                            continue
                        # Best (longest) title wins.
                        if len(men["title"] or "") > len(cur["title"] or ""):
                            cur["title"] = men["title"]
                        # Latest meeting drives date / stage / link.
                        if (men["date"] or "") >= (cur["date"] or ""):
                            cur["date"] = men["date"]
                            cur["stage"] = men["stage"] or cur["stage"]
                            cur["url"] = men["url"]
            finally:
                browser.close()

        for men in merged.values():
            yield BillRecord(
                council=self.council_id,
                bill_number=men["bill_number"],
                title=men["title"],
                bill_type=men["bill_type"],
                introducer=None,
                introduced_date=None,
                status=men["stage"],
                last_action=f"On agenda {men['date']}" if men["date"] else "On agenda",
                last_action_date=men["date"] or None,
                url=men["url"],
                raw_subject=men["title"],
            )

    def fetch_actions(self, bill_number: str) -> Iterator[ActionRecord]:
        return iter(())
