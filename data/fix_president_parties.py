#!/usr/bin/env python3
"""
fix_president_parties.py

CIK's `cik_parties_*.txt` file for the 2021 presidential elections contains
merged "committee name-candidate full names" strings (e.g.
`ИК за Румен Радев и Илияна Йотова-Румен Георгиев Радев и Илияна Малинова Йотова`).
The per-ballot `cik_candidates_*.txt` file has the clean breakdown:
    ballot_number;committee_or_party_name;list_position;candidate_names

This script repairs the existing DB by rewriting `parties.canonical_name`,
`parties.short_name` and `election_parties.name_on_ballot` for pvrns2021
president rounds from the canonical candidates file.

Idempotent. Safe to re-run.
"""

import os
import sqlite3
from pathlib import Path

REPO_ROOT = Path(__file__).parent.parent
DB_PATH = Path(os.environ.get("ELECTIONS_DB", REPO_ROOT / "elections.db"))

# (slug, path to cik_candidates file)
PRESIDENT_SOURCES = [
    ("pvrns2021_pvr_r1", REPO_ROOT / ".internal/cik-exports/pvrns2021_tur1/pvr/cik_candidates_14.11.2021.txt"),
    ("pvrns2021_pvr_r2", REPO_ROOT / ".internal/cik-exports/pvrns2021_tur2/cik_candidates_21.11.2021.txt"),
]

# Candidate committee colors — when a candidate is backed by a major party but
# runs via an initiative committee, borrow the party's color so the map/legend
# matches voter intuition. Keyed by the clean committee name in cik_candidates.
CANDIDATE_COLOR_OVERRIDES: dict[str, str] = {
    "ИК за Румен Радев и Илияна Йотова":        "#D61920",  # BSP red
    "ИК за Анастас Герджиков и Невяна Митева":  "#0054A6",  # GERB blue
}


def parse_candidates_file(path: Path) -> list[tuple[int, str, str]]:
    """Return list of (ballot_number, party_name, candidate_name)."""
    out: list[tuple[int, str, str]] = []
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line:
            continue
        parts = line.split(";")
        if len(parts) < 4:
            continue
        try:
            ballot = int(parts[0])
        except ValueError:
            continue
        party = parts[1].strip()
        candidate = parts[3].strip()
        if not party:
            continue
        out.append((ballot, party, candidate))
    return out


def short_name(canonical: str) -> str:
    if len(canonical) > 40 and " - " in canonical:
        return canonical.split(" - ")[0].strip()
    return canonical


def main() -> None:
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()

    for slug, candidates_path in PRESIDENT_SOURCES:
        row = cur.execute("SELECT id FROM elections WHERE slug = ?", (slug,)).fetchone()
        if not row:
            print(f"SKIP {slug}: election not found in DB")
            continue
        election_id = row[0]

        if not candidates_path.exists():
            print(f"SKIP {slug}: candidates file not found at {candidates_path}")
            continue

        records = parse_candidates_file(candidates_path)
        print(f"\n{slug} (id={election_id}): {len(records)} ballot entries from {candidates_path.name}")

        updated_parties = 0
        updated_ep = 0
        for ballot, clean_party, candidate in records:
            ep_row = cur.execute(
                "SELECT party_id FROM election_parties WHERE election_id = ? AND ballot_number = ?",
                (election_id, ballot),
            ).fetchone()
            if not ep_row:
                print(f"  ballot {ballot}: no election_parties row, skip")
                continue
            party_id = ep_row[0]

            # Rewrite the normalized party record, but ONLY if this party_id is
            # exclusive to president elections. Shared parties (those that also
            # appear on non-president ballots) already have a correct canonical
            # name from normalize_parties.py and must not be overwritten.
            is_exclusive = cur.execute(
                "SELECT NOT EXISTS ("
                "  SELECT 1 FROM election_parties "
                "  WHERE party_id = ? AND election_id NOT IN (15, 16)"
                ")",
                (party_id,),
            ).fetchone()[0]
            if is_exclusive:
                color = CANDIDATE_COLOR_OVERRIDES.get(clean_party)
                if color is not None:
                    cur.execute(
                        "UPDATE parties SET canonical_name = ?, short_name = ?, color = ? WHERE id = ?",
                        (clean_party, short_name(clean_party), color, party_id),
                    )
                else:
                    cur.execute(
                        "UPDATE parties SET canonical_name = ?, short_name = ? WHERE id = ?",
                        (clean_party, short_name(clean_party), party_id),
                    )
                updated_parties += cur.rowcount

            # For president elections the candidate pair is the thing the
            # voter sees on the ballot ("Румен Радев и Илияна Йотова"), not
            # the nominating party/committee. Display labels in the UI read
            # name_on_ballot, so store the candidate pair there. The party
            # affiliation is still available via parties.canonical_name.
            cur.execute(
                "UPDATE election_parties SET name_on_ballot = ? "
                "WHERE election_id = ? AND ballot_number = ?",
                (candidate, election_id, ballot),
            )
            updated_ep += cur.rowcount

            # Keep candidates table in sync: party_number should be the ballot
            # number, name should be the candidate pair. The original parser
            # mis-parsed the president cik_candidates file and put the ballot
            # number into rik_code with party_number = NULL.
            cur.execute(
                "UPDATE candidates SET party_number = ?, name = ?, rik_code = NULL "
                "WHERE election_id = ? AND (party_number = ? OR rik_code = ?)",
                (ballot, candidate, election_id, ballot, str(ballot)),
            )

        print(f"  parties rows updated: {updated_parties}")
        print(f"  election_parties rows updated: {updated_ep}")

    conn.commit()
    conn.close()
    print("\nDone.")


if __name__ == "__main__":
    main()
