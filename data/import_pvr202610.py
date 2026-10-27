#!/usr/bin/env python3
"""
import_pvr202610.py

Incremental import of the October 2026 presidential election (both rounds)
into an already-normalized `elections.db`. Same approach as
import_pe202604.py, whose helpers it reuses.

Prepared before CIK published the results. Once the export is out:

  1. Download results.cik.bg/pvr202610/tur1/opendata/export.zip (and tur2
     after the runoff), extract to data/cik-exports/pvr202610_tur{1,2}/.
  2. python3 data/import_pvr202610.py            # imports every round present
  3. python3 data/score_sections.py              # anomaly scores + violations
  4. Check the CIK protocol link of one section in the UI (see
     build_protocol_urls.py — the pvr202610 config is unverified).

Per round (idempotent — re-running replaces that round's rows):
  • parse via parsers.pvr202610 into a temp DB
  • election row, ballots (committee → parties, candidate pair → name_on_ballot,
    same shape normalize_parties.finalize_president_ballots gives 2021),
    sections + locations, protocols, votes, candidates, protocol URLs,
    geography FKs
  • coordinates: inline from sections.txt; sections without them are filled
    from .internal/external-coords/cik-map-pvr202610.json (map.cik.bg,
    fetched 2026-10-27 — 7,710 places, 12,464 section codes)
  • sanity checks that abort before commit if the export doesn't match the
    pe202604 layout the parser assumes (no protocols, no votes, wrong forms)

Usage:
  python3 data/import_pvr202610.py
  python3 data/import_pvr202610.py --round 2
  python3 data/import_pvr202610.py --db /tmp/copy.db --exports-dir /tmp/fake-exports
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parent

sys.path.insert(0, str(HERE))
from parsers import pvr202610 as parser  # noqa: E402
from parsers.common import RESULTS_DIR  # noqa: E402
from build_protocol_urls import ELECTION_CONFIG, build_url  # noqa: E402
from normalize_parties import PRESIDENT_CANDIDATE_COLORS, short_name  # noqa: E402
from import_pe202604 import (  # noqa: E402
    backfill_geography_fks,
    build_party_index,
    copy_candidates,
    copy_protocols_votes_preferences,
    copy_sections_and_locations,
    delete_existing,
    ensure_columns,
    insert_election,
    norm_party,
)

DEFAULT_DB = REPO_ROOT / "elections.db"
MAP_COORDS = REPO_ROOT / ".internal" / "external-coords" / "cik-map-pvr202610.json"

# cik-links.ts keys CIK configs by election id. These are the ids the rounds
# get when imported straight after pe202604 (id 19); the import warns if not.
EXPECTED_IDS = {"pvr202610_r1": 20, "pvr202610_r2": 21}


class SanityError(Exception):
    pass


def load_map_coords(path: Path) -> dict[str, tuple[float, float]]:
    if not path.exists():
        print(f"  WARN: {path} not found — no coordinate fallback")
        return {}
    with path.open() as f:
        rows = json.load(f)["rows"]
    return {
        code: (r["lat"], r["lon"])
        for r in rows
        if r.get("lat") is not None and r.get("lon") is not None
        for code in r["section_codes"]
    }


def copy_president_ballots(conn: sqlite3.Connection, temp: sqlite3.Connection,
                           eid: int, temp_eid: int) -> dict:
    """Committee → canonical party (matched or created); candidate pair → name_on_ballot."""
    party_index = build_party_index(conn)
    candidate_by_ballot = dict(temp.execute(
        "SELECT party_number, name FROM candidates WHERE election_id = ?", (temp_eid,)
    ).fetchall())
    rows = temp.execute(
        "SELECT number, name FROM parties WHERE election_id = ? ORDER BY number", (temp_eid,)
    ).fetchall()

    matched = created = 0
    for ballot, committee in rows:
        key = norm_party(committee)
        pid = party_index.get(key) if key else None
        if pid is None:
            pid = conn.execute(
                "INSERT INTO parties (canonical_name, short_name, color) VALUES (?, ?, ?)",
                (committee, short_name(committee), PRESIDENT_CANDIDATE_COLORS.get(committee)),
            ).lastrowid
            if key:
                party_index[key] = pid
            created += 1
        else:
            matched += 1
            if committee in PRESIDENT_CANDIDATE_COLORS:
                conn.execute("UPDATE parties SET color = ? WHERE id = ?",
                             (PRESIDENT_CANDIDATE_COLORS[committee], pid))
        conn.execute(
            "INSERT INTO election_parties (election_id, ballot_number, party_id, name_on_ballot) "
            "VALUES (?, ?, ?, ?)",
            (eid, ballot, pid, candidate_by_ballot.get(ballot) or committee),
        )
    return {"total": len(rows), "matched": matched, "created": created}


def populate_protocol_urls(conn: sqlite3.Connection, eid: int, slug: str) -> int:
    cfg = ELECTION_CONFIG[slug]
    rows = conn.execute(
        "SELECT id, section_code, machine_count FROM sections WHERE election_id = ?", (eid,)
    ).fetchall()
    conn.executemany(
        "UPDATE sections SET protocol_url = ? WHERE id = ?",
        [(build_url(cfg, code, mc or 0), sid) for sid, code, mc in rows],
    )
    return len(rows)


def sanity_check(conn: sqlite3.Connection, eid: int, slug: str) -> list[str]:
    """Abort on layout mismatches; return warnings for softer issues."""
    q = lambda sql: conn.execute(sql, (eid,)).fetchone()[0]  # noqa: E731
    sections = q("SELECT COUNT(*) FROM sections WHERE election_id = ?")
    protocols = q("SELECT COUNT(DISTINCT section_code) FROM protocols WHERE election_id = ?")
    votes = q("SELECT COUNT(*) FROM votes WHERE election_id = ?")
    ballots = q("SELECT COUNT(*) FROM election_parties WHERE election_id = ?")
    no_coords = q("SELECT COUNT(*) FROM sections WHERE election_id = ? AND (lat IS NULL OR lng IS NULL)")

    errors = []
    if sections == 0:
        errors.append("no sections parsed")
    if ballots == 0:
        errors.append("no ballots parsed — check cik_candidates / cik_parties layout")
    if protocols < 0.9 * sections:
        errors.append(f"protocols for only {protocols:,}/{sections:,} sections — "
                      "form numbers likely differ from pe202604's 24/26/28/30")
    if votes == 0:
        errors.append("no votes parsed — votes layout likely differs from stride 4")
    if errors:
        raise SanityError(f"{slug}: " + "; ".join(errors))

    # Valid votes per section should equal the sum of ballot votes.
    mismatched = q("""
        SELECT COUNT(*) FROM (
          SELECT p.section_code,
                 p.actual_voters - COALESCE(p.invalid_votes,0) - COALESCE(p.null_votes,0) AS valid,
                 (SELECT SUM(total) FROM votes v
                   WHERE v.election_id = p.election_id AND v.section_code = p.section_code) AS summed
            FROM protocols p WHERE p.election_id = ?
        ) WHERE valid IS NOT NULL AND summed IS NOT NULL AND valid <> summed
    """)
    warnings = []
    if no_coords:
        warnings.append(f"{no_coords:,} sections without coordinates")
    if mismatched > 0.05 * protocols:
        warnings.append(f"{mismatched:,} sections where actual − invalid − null ≠ Σ votes "
                        "(check protocol field positions)")
    if EXPECTED_IDS.get(slug) != eid:
        warnings.append(f"election id {eid} ≠ {EXPECTED_IDS.get(slug)} expected by "
                        "web/src/lib/cik-links.ts — update its CIK_ELECTION_MAP keys")
    return warnings


def import_round(conn: sqlite3.Connection, temp: sqlite3.Connection, spec: dict,
                 temp_eid: int, coords: dict) -> int:
    slug = spec["slug"]
    old = delete_existing(conn, slug)
    if old:
        print(f"  Removed prior {slug} (was election id {old})")
    eid = insert_election(conn, slug, spec["name"], spec["type"], spec["date"], spec["round"])
    print(f"  {slug}: election id {eid}")

    b = copy_president_ballots(conn, temp, eid, temp_eid)
    print(f"    Ballots: {b['total']} (matched {b['matched']}, created {b['created']})")

    s = copy_sections_and_locations(conn, temp, eid, temp_eid, fallback_coords=coords)
    print(f"    Sections: {s['sections']:,}  locations: +{s['new_locations']:,} new, "
          f"~{s['reused_locations']:,} reused, {s['coord_updates']:,} coord updates")

    pvp = copy_protocols_votes_preferences(conn, temp, eid, temp_eid)
    print(f"    Protocols: {pvp['protocols']:,}  Votes: {pvp['votes']:,}")

    print(f"    Candidates: {copy_candidates(conn, temp, eid, temp_eid):,}")
    print(f"    Protocol URLs: {populate_protocol_urls(conn, eid, slug):,}")

    g = backfill_geography_fks(conn, eid)
    print(f"    Geography FKs: mun={g['municipality']:,} dist={g['district']:,} "
          f"rik={g['rik']:,} kmet={g['kmetstvo']:,}")

    for w in sanity_check(conn, eid, slug):
        print(f"    WARN: {w}")
    return eid


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", type=Path, default=DEFAULT_DB)
    ap.add_argument("--exports-dir", type=Path, default=Path(RESULTS_DIR))
    ap.add_argument("--coords", type=Path, default=MAP_COORDS)
    ap.add_argument("--round", type=int, choices=(1, 2), default=None,
                    help="Import only this round (default: every round present)")
    ap.add_argument("--temp", type=Path, default=Path("/tmp/pvr202610_parse.db"))
    args = ap.parse_args()

    if not args.db.exists():
        print(f"Target DB not found: {args.db}", file=sys.stderr)
        return 1

    t0 = time.monotonic()
    args.temp.unlink(missing_ok=True)
    print(f"Parsing pvr202610 from {args.exports_dir} → {args.temp}")
    parsed = parser.parse(str(args.temp), results_dir=str(args.exports_dir))["elections"]
    specs = [e for e in parser.ELECTIONS
             if e["slug"] in parsed and (args.round is None or e["round"] == args.round)]
    if not specs:
        print("Nothing to import — no export directory found for the requested round(s).",
              file=sys.stderr)
        return 1

    coords = load_map_coords(args.coords)
    print(f"Map coordinates: {len(coords):,} section codes")

    conn = sqlite3.connect(args.db)
    conn.execute("PRAGMA foreign_keys = OFF")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA synchronous = NORMAL")
    temp = sqlite3.connect(f"file:{args.temp}?mode=ro", uri=True)
    try:
        ensure_columns(conn)
        for spec in specs:
            import_round(conn, temp, spec, parsed[spec["slug"]], coords)
        conn.commit()
    except SanityError as e:
        conn.rollback()
        print(f"\nABORTED, nothing written: {e}", file=sys.stderr)
        return 2
    finally:
        temp.close()
        conn.close()

    print(f"\nDone in {time.monotonic() - t0:.1f}s. Next: python3 data/score_sections.py")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
