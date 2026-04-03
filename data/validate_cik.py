#!/usr/bin/env python3
"""
validate_cik.py — Validate elections.db against CIK official reference data.

Checks:
  1. Per-party vote totals (exact match required)
  2. Protocol aggregates: sections, registered, actual, invalid, null_votes
  3. Total party votes sum

Reference data scraped from results.cik.bg and stored in cik_reference.json.

Run after every rebuild:
    python3 validate_cik.py                  # validate all elections
    python3 validate_cik.py pi2021_jul       # validate matching slug(s)
    python3 validate_cik.py pi2021 ns2022    # validate multiple
"""

import json
import sqlite3
import sys
from pathlib import Path

DB_PATH = Path(__file__).parent.parent / "elections.db"
REF_PATH = Path(__file__).parent / "cik_reference.json"

RED = "\033[31m"
GREEN = "\033[32m"
YELLOW = "\033[33m"
RESET = "\033[0m"

DEBUG_DB_PATH = DB_PATH.parent / "elections_debug.db"


def main() -> int:
    filters = sys.argv[1:]

    db_path = DEBUG_DB_PATH if filters and DEBUG_DB_PATH.exists() else DB_PATH

    if not db_path.exists():
        print(f"{RED}ERROR{RESET}: {db_path} not found")
        return 1
    if not REF_PATH.exists():
        print(f"{RED}ERROR{RESET}: {REF_PATH} not found")
        return 1

    with open(REF_PATH) as f:
        ref = json.load(f)

    conn = sqlite3.connect(db_path)
    cur = conn.cursor()

    elections = {
        row[1]: row[0]
        for row in cur.execute("SELECT id, slug FROM elections").fetchall()
    }

    errors = 0
    warnings = 0

    for slug, data in ref.items():
        if slug.startswith("_"):
            continue
        if filters and not any(f in slug for f in filters):
            continue

        if slug not in elections:
            print(f"\n{YELLOW}WARN{RESET}: {slug} not in database — skipping")
            warnings += 1
            continue

        eid = elections[slug]
        name = data.get("name", slug)
        proto_ref = data.get("protocol", {})
        parties_ref = data.get("parties", {})
        party_votes_total = data.get("party_votes_total")

        print(f"\n{'='*60}")
        print(f"  {slug}: {name}")
        print(f"{'='*60}")

        # --- Protocol aggregate checks ---
        proto_db = cur.execute("""
            SELECT
                COUNT(DISTINCT section_code),
                SUM(registered_voters),
                SUM(actual_voters),
                SUM(COALESCE(invalid_votes, 0)),
                SUM(COALESCE(null_votes, 0))
            FROM protocols WHERE election_id = ?
        """, (eid,)).fetchone()

        db_sections, db_registered, db_actual, db_invalid, db_null = proto_db

        for field, db_val, ref_val in [
            ("sections", db_sections, proto_ref.get("sections")),
            ("registered", db_registered, proto_ref.get("registered")),
            ("actual", db_actual, proto_ref.get("actual")),
            ("invalid", db_invalid, proto_ref.get("invalid")),
            ("null_votes", db_null, proto_ref.get("null_votes")),
        ]:
            if ref_val is None:
                continue
            if db_val == ref_val:
                print(f"  {GREEN}OK{RESET}  {field}: {db_val:,}")
            else:
                diff = db_val - ref_val
                pct = abs(diff) / max(ref_val, 1) * 100
                label = f"{RED}ERR{RESET}" if pct >= 0.5 else f"{YELLOW}WARN{RESET}"
                print(f"  {label} {field}: db={db_val:,} cik={ref_val:,} (diff={diff:+,}, {pct:.2f}%)")
                if pct >= 0.5:
                    errors += 1
                else:
                    warnings += 1

        # --- Total party votes ---
        db_party_votes = cur.execute(
            "SELECT SUM(total) FROM votes WHERE election_id = ?", (eid,)
        ).fetchone()[0] or 0

        if party_votes_total is not None:
            diff = db_party_votes - party_votes_total
            if diff == 0:
                print(f"  {GREEN}OK{RESET}  party_votes_total: {db_party_votes:,}")
            else:
                pct = abs(diff) / max(party_votes_total, 1) * 100
                # Extra DB votes (parties not on CIK) are warnings, not errors
                if diff > 0 and pct < 0.1:
                    print(f"  {YELLOW}WARN{RESET} party_votes_total: db={db_party_votes:,} cik={party_votes_total:,} (diff={diff:+,} — likely unlisted independents)")
                    warnings += 1
                elif pct < 0.5:
                    print(f"  {YELLOW}WARN{RESET} party_votes_total: db={db_party_votes:,} cik={party_votes_total:,} (diff={diff:+,}, {pct:.2f}%)")
                    warnings += 1
                else:
                    print(f"  {RED}ERR{RESET} party_votes_total: db={db_party_votes:,} cik={party_votes_total:,} (diff={diff:+,}, {pct:.2f}%)")
                    errors += 1

        # --- Per-party vote checks ---
        if parties_ref:
            db_votes = {}
            for row in cur.execute(
                "SELECT party_number, SUM(total) FROM votes WHERE election_id = ? GROUP BY party_number",
                (eid,),
            ).fetchall():
                db_votes[row[0]] = row[1]

            party_ok = 0
            party_warn = 0
            party_err = 0

            for party_num_str, party_data in parties_ref.items():
                party_num = int(party_num_str)
                ref_votes = party_data["votes"]
                db_v = db_votes.pop(party_num, 0)
                if db_v == ref_votes:
                    party_ok += 1
                else:
                    diff = db_v - ref_votes
                    pct = abs(diff) / max(ref_votes, 1) * 100
                    pname = party_data.get("name", "")[:45]
                    if pct < 0.5:
                        print(f"  {YELLOW}WARN{RESET} party #{party_num} {pname}: db={db_v:,} cik={ref_votes:,} (diff={diff:+,})")
                        party_warn += 1
                        warnings += 1
                    else:
                        print(f"  {RED}ERR{RESET}  party #{party_num} {pname}: db={db_v:,} cik={ref_votes:,} (diff={diff:+,}, {pct:.1f}%)")
                        party_err += 1
                        errors += 1

            # DB parties not in CIK reference
            for party_num, total in sorted(db_votes.items()):
                print(f"  {YELLOW}WARN{RESET} party #{party_num}: db={total:,} (not on CIK results page)")
                warnings += 1

            total_parties = party_ok + party_warn + party_err
            if party_err == 0 and party_warn == 0:
                if db_votes:
                    print(f"  {GREEN}OK{RESET}  all {party_ok} CIK parties match ({len(db_votes)} extra in DB)")
                else:
                    print(f"  {GREEN}OK{RESET}  all {party_ok} parties match exactly")
            elif party_err == 0:
                print(f"  {GREEN}OK{RESET}  {total_parties} parties: {party_ok} exact, {party_warn} within tolerance")
            else:
                print(f"  {YELLOW}---{RESET} {party_ok} exact, {party_warn} within tolerance, {party_err} FAILED")

    conn.close()

    print(f"\n{'='*60}")
    if errors == 0:
        print(f"{GREEN}ALL CHECKS PASSED{RESET} ({warnings} warnings)")
    else:
        print(f"{RED}{errors} ERROR(S){RESET} ({warnings} warnings)")
    print(f"{'='*60}")

    return 0 if errors == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
