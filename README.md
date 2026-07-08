# Tracker

Civic-data tracking tools.

## Modules

### Legislative Tracker

Tracks bills before Hawaii's four county councils — Honolulu, Maui, Hawaii County, Kauai — across four subject areas: **Tax**, **Transportation**, **Food Security**, and **Affordable Housing**.

- Daily scrape of all four councils
- Bills classified into subject areas via keyword rules
- New bills and status changes posted to Slack
- Browsable static dashboard: <https://dtomkatsu.github.io/Tracker/>

#### Stack

- Python 3.11+ (requests, beautifulsoup4, pydantic)
- SQLite for storage (`data/bills.db`)
- Vanilla JS static dashboard, hosted on GitHub Pages
- GitHub Actions cron for daily scraping

#### Quick start

```bash
uv sync                              # or: pip install -e .
python -m tracker.legislative scrape --council maui
python -m tracker.legislative diff --since 2026-01-01
python site_build.py
python -m http.server -d site 8000   # preview dashboard
```

#### Data sources

| Council | Source | Method |
|---|---|---|
| Maui | `webapi.legistar.com/v1/mauicounty/` | Legistar InSite JSON API |
| Hawaii County | `hawaiicounty.granicus.com` agenda PDFs + `records.hawaiicounty.gov` (Laserfiche) | headless-browser agenda parse, enriched with Laserfiche template metadata |
| Kauai | `kauai.granicus.com` agenda HTML | headless-browser agenda parse |
| Honolulu | `hnldoc.ehawaii.gov/hnldoc` | JSON browse endpoints + measure-page scrape |

Hawaii County and Kauai have no bill API (their Legistar tenants are
unprovisioned), so their inventory is reconstructed from council meeting
agendas. Parsed agendas are cached in the DB (`agenda_mentions`): each agenda
is fetched once, and the daily scrape only re-reads agendas that are new or
recent enough to still be amended. A bill's agenda appearances double as its
action history for these councils. After changing the agenda-parsing rules,
re-run with `--refetch-agendas` to rebuild the cache.

All council bill data is public record.
