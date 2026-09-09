#!/usr/bin/env python3
"""Mail each person their own buddy nudges, once a day.

The programme has always been able to say which pairings have stopped. Nothing
ever said it to anybody: `GET /buddy/admin/digest` shows a teacher the chase
list if they open the tab, and `GET /buddy/my-nudges` shows a student their own
share if they open the app. A stalled pairing is precisely the one nobody is
opening, so both of those reach everyone except the people who need reaching.

This is the part that leaves. It does not re-decide who is quiet — it reads
`app.buddy.digest`, which already produces an *addressed* worklist, and mails
each recipient their own entries. Adding delivery stays a delivery change, and
the rule for what counts as stalled stays in one place.

Usage
-----
    python scripts/send_buddy_digest.py --dry-run   # print, send nothing
    python scripts/send_buddy_digest.py             # send

Run from the repo root: the stores resolve `outputs/` relative to the working
directory.

Sending twice
-------------
Every send is appended to ``outputs/buddy_digest_sent.jsonl`` keyed by
recipient and date, and a recipient already recorded for today is skipped. This
is not tidiness. The box is stopped between demos and the timer is
`Persistent=true`, so a missed daily run fires on the next boot — and a machine
started three times in a day would otherwise mail the whole cohort three times.
Being nagged by software is how people learn to filter it.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime
from datetime import timezone
from pathlib import Path
from typing import Optional

# Import as the app does, so the stores read the same `outputs/` paths.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.buddy import digest as digest_module  # noqa: E402
from app.buddy import identity  # noqa: E402
from app.core.mailer import send  # noqa: E402

SENT_LOG = Path("outputs/buddy_digest_sent.jsonl")

SUBJECT = "Your speaking buddy needs a moment"

INTRO = {
    "teacher": (
        "These pairings need something only you can do — a cycle opened, a "
        "cycle closed, or a word with the two people in it."
    ),
    "mentor": "You are mentoring someone who has not heard from you in a while.",
    "mentee": "Your speaking buddy pairing has gone quiet.",
}


def _today() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def already_sent_today() -> set[str]:
    """Recipients already mailed today, so a re-run is a no-op."""
    if not SENT_LOG.exists():
        return set()

    today = _today()
    sent: set[str] = set()
    for line in SENT_LOG.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            # A half-written line must not make the job think it has sent
            # nothing and mail everyone again. Skip the row, keep the rest.
            continue
        if row.get("date") == today and row.get("user_id"):
            sent.add(row["user_id"])
    return sent


def record_sent(user_id: str, email: str, count: int) -> None:
    SENT_LOG.parent.mkdir(parents=True, exist_ok=True)
    row = {
        "date": _today(),
        "user_id": user_id,
        "email": email,
        "nudges": count,
        "at": datetime.now(timezone.utc).isoformat(),
    }
    with SENT_LOG.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(row, ensure_ascii=False) + "\n")


def compose(nudges: list) -> str:
    """One person's message: what to do, then why it is being said.

    The evidence line matters as much as the instruction. "Pick this back up"
    is easy to dismiss; "silent 12 days, 3 sessions kept before it stopped"
    says this was working and then stopped, which is a different message from
    one that never started.
    """
    role = nudges[0].role
    lines = [INTRO.get(role, INTRO["mentee"]), ""]

    for nudge in nudges:
        lines.append(f"- {nudge.message}")
        detail = []
        if nudge.partner is not None:
            detail.append(f"with {nudge.partner.name or nudge.partner.email or 'them'}")
        if nudge.days_overdue is not None:
            detail.append(f"{nudge.days_overdue} days past the cycle's end date")
        if nudge.days_quiet is not None:
            detail.append(f"silent {nudge.days_quiet} days")
        if nudge.sessions_kept > 0:
            detail.append(f"{nudge.sessions_kept} sessions kept before it stopped")
        if detail:
            lines.append(f"  ({', '.join(detail)})")

    lines += ["", "Open Speaking Buddy to pick it back up."]
    return "\n".join(lines)


def main(argv: Optional[list[str]] = None) -> int:
    """`argv` is taken as an argument so a test can drive this directly."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="print what would be sent; send nothing and record nothing",
    )
    args = parser.parse_args(argv)

    try:
        report = digest_module.build_digest()
    except Exception as exc:
        print(f"! could not build the digest: {type(exc).__name__}: {exc}")
        return 2

    if report.total == 0:
        print("Nothing outstanding — no mail to send.")
        return 0

    by_person: dict[str, list] = {}
    for nudge in report.nudges:
        by_person.setdefault(nudge.user_id, []).append(nudge)

    already = set() if args.dry_run else already_sent_today()
    sent = skipped = failed = 0

    for user_id, nudges in by_person.items():
        if user_id in already:
            print(f"  · {user_id}: already mailed today, skipping")
            skipped += 1
            continue

        # The nudge already carries the resolved person; fall back to a lookup
        # only for a nudge built before that was true.
        person = nudges[0].person
        email = (person.email if person else None) or identity.email_for(user_id)
        if not email:
            # Someone the users log has never seen has no address, and no
            # lookup will invent one. Report it rather than failing silently:
            # it means a real person is not being reached.
            print(f"  ! {user_id}: no address on file, cannot reach them")
            skipped += 1
            continue

        body = compose(nudges)

        if args.dry_run:
            print(f"\n--- to {email} ({len(nudges)} nudge(s)) ---")
            print(body)
            sent += 1
            continue

        if send(email, SUBJECT, body):
            record_sent(user_id, email, len(nudges))
            sent += 1
        else:
            failed += 1

    verb = "would send" if args.dry_run else "sent"
    print(f"\n{verb} {sent}, skipped {skipped}, failed {failed}")
    # A failed send is worth a non-zero exit so a timer's status shows it.
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
