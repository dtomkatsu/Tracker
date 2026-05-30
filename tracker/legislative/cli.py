"""CLI entry point: python -m tracker.legislative <command> ..."""

from __future__ import annotations

import argparse
import json
import logging
import sys
from datetime import date
from pathlib import Path

from tracker.legislative import COUNCILS
from tracker.legislative.db import DEFAULT_DB
from tracker.legislative.diff import diff_since
from tracker.legislative.notify import post as post_slack
from tracker.legislative.scrape import scrape_all, scrape_council


def _parse_date(s: str | None) -> date | None:
    if not s:
        return None
    return date.fromisoformat(s)


def cmd_scrape(args: argparse.Namespace) -> int:
    if args.council == "all":
        results = scrape_all(db_path=args.db, since=_parse_date(args.since))
    else:
        results = [
            scrape_council(
                args.council, db_path=args.db, since=_parse_date(args.since)
            )
        ]
    print(json.dumps(results, indent=2))
    return 0


def cmd_diff(args: argparse.Namespace) -> int:
    out = diff_since(since_iso=args.since, db_path=args.db)
    if args.output:
        Path(args.output).write_text(json.dumps(out, indent=2))
    else:
        print(json.dumps(out, indent=2))
    return 0


def cmd_notify(args: argparse.Namespace) -> int:
    diff_path = Path(args.diff)
    diff = json.loads(diff_path.read_text())
    ok = post_slack(diff, webhook_url=args.webhook, dry_run=args.dry_run)
    return 0 if ok else 1


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    p = argparse.ArgumentParser(prog="tracker.legislative")
    p.add_argument("--db", type=Path, default=DEFAULT_DB)
    sub = p.add_subparsers(dest="cmd", required=True)

    sp = sub.add_parser("scrape", help="scrape one or all councils")
    sp.add_argument("--council", choices=["all", *COUNCILS], default="all")
    sp.add_argument("--since", help="YYYY-MM-DD; only fetch bills since this date")
    sp.set_defaults(fn=cmd_scrape)

    dp = sub.add_parser("diff", help="diff against a prior point in time")
    dp.add_argument(
        "--since",
        help="ISO timestamp; if omitted, uses the second-most-recent run",
    )
    dp.add_argument("--output", help="write JSON to this path")
    dp.set_defaults(fn=cmd_diff)

    np = sub.add_parser("notify", help="post a diff to Slack")
    np.add_argument("--diff", required=True, help="path to diff JSON")
    np.add_argument("--webhook", help="Slack webhook URL (or SLACK_WEBHOOK_URL env)")
    np.add_argument("--dry-run", action="store_true")
    np.set_defaults(fn=cmd_notify)

    args = p.parse_args(argv)
    return args.fn(args)


if __name__ == "__main__":
    sys.exit(main())
