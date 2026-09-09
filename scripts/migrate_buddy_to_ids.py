#!/usr/bin/env python3
"""Rewrite the buddy JSONL stores from email keys to user ids.

The buddy programme used to identify everyone by email address. It now keys
every row on ``user_id`` — the platform's own user id (``User.uid``), which is
what ``outputs/users.jsonl`` records as ``firebase_uid`` and what debates and
GD have always stored. See ``app/buddy/identity.py`` for why.

Rows written before that change carry the old field names and email values,
and the stores skip any row that no longer matches its model — silently, by
design, so one bad row cannot blank a panel. That silence is the danger here:
without this migration an unmigrated deployment does not error, it simply
shows an empty buddy programme. Run it once, before deploying the new code.

Usage
-----
    python scripts/migrate_buddy_to_ids.py            # report only
    python scripts/migrate_buddy_to_ids.py --apply    # write the changes
    python scripts/migrate_buddy_to_ids.py --apply --force

Safe to run twice: rows that already use the new field names are left alone
and counted as "already migrated".

An address that is not in ``users.jsonl`` cannot be resolved to an id — that
user has never signed in since the users log existed, and no lookup will
invent them. Those rows are reported and the migration refuses to run, because
dropping somebody's pairing quietly is exactly the failure mode this script
exists to avoid. ``--force`` drops them anyway, after printing each one.
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from datetime import datetime
from pathlib import Path

OUTPUTS = Path("outputs")
USERS = OUTPUTS / "users.jsonl"

# filename -> {old field: new field}. Fields whose VALUE is an email and must
# be mapped to an id are listed in RESOLVE below; everything else is a rename.
RENAMES: dict[str, dict[str, str]] = {
    "buddy_mentors.jsonl": {"email": "user_id", "decided_by": "decided_by_id"},
    "buddy_pairs.jsonl": {
        "mentor_email": "mentor_id",
        "mentee_email": "mentee_id",
        "created_by": "created_by_id",
    },
    "buddy_messages.jsonl": {"sender_email": "sender_id"},
    "buddy_cycles.jsonl": {
        "mentee_email": "mentee_id",
        "created_by": "created_by_id",
    },
    "buddy_sessions.jsonl": {"created_by": "created_by_id"},
    "buddy_concerns.jsonl": {
        "raised_by": "raised_by_id",
        "resolved_by": "resolved_by_id",
    },
}

# New field names whose values are addresses needing resolution to an id.
RESOLVE = {
    "user_id",
    "decided_by_id",
    "mentor_id",
    "mentee_id",
    "created_by_id",
    "sender_id",
    "raised_by_id",
    "resolved_by_id",
}

# Denormalised display copies. Names are now resolved from the users log at
# read time, so a stored copy is only something that can go stale.
DROP: dict[str, tuple[str, ...]] = {
    "buddy_mentors.jsonl": ("name",),
    "buddy_pairs.jsonl": ("mentor_name", "mentee_name"),
}


def read_jsonl(path: Path) -> list[dict]:
    if not path.exists():
        return []
    rows = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            rows.append(json.loads(line))
        except json.JSONDecodeError:
            print(f"  ! skipping unparseable line in {path.name}")
    return rows


def load_email_map() -> dict[str, str]:
    """email (lowercased) -> firebase_uid, from the users log."""
    mapping: dict[str, str] = {}
    for row in read_jsonl(USERS):
        email = (row.get("email") or "").strip().lower()
        uid = row.get("firebase_uid")
        if email and uid:
            mapping[email] = uid
    return mapping


def migrate_file(
    name: str, emails: dict[str, str], unresolved: set[str]
) -> tuple[list[dict], int, int]:
    """Return (rows, changed, already) for one store."""
    path = OUTPUTS / name
    rows = read_jsonl(path)
    renames = RENAMES[name]
    drops = DROP.get(name, ())

    out: list[dict] = []
    changed = 0
    already = 0

    for row in rows:
        if not any(old in row for old in renames):
            already += 1
            out.append(row)
            continue

        new_row = dict(row)
        for field in drops:
            new_row.pop(field, None)

        for old, new in renames.items():
            if old not in new_row:
                continue
            value = new_row.pop(old)
            if value is None or value == "":
                new_row[new] = value
                continue
            if new in RESOLVE:
                uid = emails.get(str(value).strip().lower())
                if uid is None:
                    unresolved.add(str(value))
                    new_row[new] = None  # marked; the caller decides
                else:
                    new_row[new] = uid
            else:
                new_row[new] = value

        changed += 1
        out.append(new_row)

    return out, changed, already


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="write the changes")
    parser.add_argument(
        "--force",
        action="store_true",
        help="drop rows whose address is not in the users log",
    )
    args = parser.parse_args()

    if not USERS.exists():
        print(f"! {USERS} not found — run this from the repo root.")
        return 2

    emails = load_email_map()
    print(f"users.jsonl: {len(emails)} addresses mapped to ids\n")

    unresolved: set[str] = set()
    migrated: dict[str, list[dict]] = {}
    total_changed = 0

    for name in RENAMES:
        rows, changed, already = migrate_file(name, emails, unresolved)
        migrated[name] = rows
        total_changed += changed
        state = f"{changed} to migrate, {already} already migrated"
        print(f"{name:28} {len(rows):4} rows  ({state})")

    if unresolved:
        print("\n! These addresses are not in users.jsonl and cannot become ids:")
        for address in sorted(unresolved):
            print(f"    {address}")
        if not args.force:
            print(
                "\nRefusing to migrate: the rows referencing them would lose their\n"
                "owner. Have each of them sign in once (which writes a users.jsonl\n"
                "row), then re-run. Use --force to drop those references instead."
            )
            return 1
        print("\n--force given: those references will be written as null.\n")

    if total_changed == 0:
        print("\nNothing to do — every row already uses ids.")
        return 0

    if not args.apply:
        print(f"\nDry run. {total_changed} rows would change. Re-run with --apply.")
        return 0

    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup_dir = OUTPUTS / f"buddy-backup-{stamp}"
    backup_dir.mkdir(parents=True, exist_ok=True)

    for name, rows in migrated.items():
        path = OUTPUTS / name
        if path.exists():
            shutil.copy2(path, backup_dir / name)
        with path.open("w", encoding="utf-8") as handle:
            for row in rows:
                handle.write(json.dumps(row, ensure_ascii=False) + "\n")

    print(f"\nMigrated {total_changed} rows. Originals copied to {backup_dir}/")
    return 0


if __name__ == "__main__":
    sys.exit(main())
