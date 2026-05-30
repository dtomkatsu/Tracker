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
| Hawaii County | `hawaiicounty.legistar.com` | Legistar website scrape (API not provisioned) |
| Kauai | `kauai.legistar.com` | Legistar website scrape (API not provisioned) |
| Honolulu | `hnldoc.ehawaii.gov/hnldoc` | Tyler/eHawaii.gov HTML scrape |

All council bill data is public record.
