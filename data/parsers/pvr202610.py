#!/usr/bin/env python3
"""
pvr202610.py — Parser for the October 2026 presidential election.

Two elections (one per round):
  pvr202610_r1 — Президент 25.10.2026 (първи тур)
  pvr202610_r2 — Президент 01.11.2026 (втори тур)

Source: results.cik.bg/pvr202610/tur{1,2}/opendata/export.zip, extracted to
data/cik-exports/pvr202610_tur1/ and data/cik-exports/pvr202610_tur2/.
A round whose directory is missing is skipped, so round 1 can be imported
before round 2 is published.

Layout per readme_25.10.2026.txt (differs from pe202604 — protocols and
votes changed shape for the presidential ballot):
  • sections: 11 fields, (lon, lat) inline. 17 addresses contain ";" so the
    row is read from both ends; ПСИК rows have empty coordinates.
  • protocols: one main protocol per section (24/26/28/30 paper, 25/29
    machine) plus one 32/41 line per voting machine, merged per section.
  • votes: section;admin_unit; then per ballot
    number;total;paper;machine;machine1;machine2 (stride 6).
  • ballots: cik_candidates, pvrns2021 layout.
"""

import os
import sqlite3

from parsers.common import (
    RESULTS_DIR, create_temp_db, insert_election,
    find_file, read_lines, safe_int,
)
from parsers.pe202604 import _safe_float
from parsers.pvrns2021 import parse_president_parties_and_candidates


ELECTIONS = [
    {
        "slug":    "pvr202610_r1",
        "name":    "Президент 25.10.2026 (първи тур)",
        "type":    "president",
        "date":    "2026-10-25",
        "round":   1,
        "rel_path": "pvr202610_tur1",
    },
    {
        "slug":    "pvr202610_r2",
        "name":    "Президент 01.11.2026 (втори тур)",
        "type":    "president",
        "date":    "2026-11-01",
        "round":   2,
        "rel_path": "pvr202610_tur2",
    },
]


PAPER_FORMS = (24, 26, 28, 30)     # Х, КР-Х, ХЧ, КРЧ-Х
MACHINE_FORMS = (25, 29)           # М, МЧ
MACHINE_DATA_FORMS = (32, 41)      # one line per machine


def parse_sections_with_coords(filepath: str, election_id: int, cur: sqlite3.Cursor) -> int:
    """section;rik;rik_name;ekatte;settlement;address…;lon;lat;mobile;ship;machines"""
    rows = []
    for line in read_lines(filepath):
        p = line.split(";")
        if len(p) < 11:
            continue
        lon, lat = _safe_float(p[-5]), _safe_float(p[-4])
        rows.append((
            election_id, p[0].strip(), p[1].strip(), p[2].strip(), p[3].strip(),
            p[4].strip(), ";".join(p[5:-5]).strip(),
            safe_int(p[-3]) or 0, safe_int(p[-2]) or 0, safe_int(p[-1]) or 0,
            lat, lon,
        ))
    cur.executemany(
        "INSERT INTO sections (election_id, section_code, rik_code, rik_name, ekatte, "
        "settlement_name, address, is_mobile, is_ship, machine_count, lat, lng) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        rows,
    )
    return len(rows)


def parse_protocols(filepath: str, election_id: int, cur: sqlite3.Cursor) -> int:
    """
    One row per section from its main protocol (0-indexed fields):
      p[5] received (А)   p[8] registered   p[9] added   p[10] voted
      paper forms:   p[12] invalid, p[16] „Не подкрепям никого“
      КР-Х/КРЧ-Х:    + p[19] (9.3) and p[23] (11.3) null votes on control receipts
    null_votes adds p[27] from every 32/41 machine line of the section.
    """
    main: dict[str, list] = {}
    machine_null: dict[str, int] = {}
    for line in read_lines(filepath):
        p = line.split(";")
        form = safe_int(p[0])
        if len(p) < 3 or form is None:
            continue
        section = p[1].strip()
        if form in MACHINE_DATA_FORMS:
            machine_null[section] = machine_null.get(section, 0) + (safe_int(p[27]) or 0 if len(p) > 27 else 0)
            continue
        if form not in PAPER_FORMS + MACHINE_FORMS:
            continue
        g = lambda i: safe_int(p[i]) if len(p) > i else None  # noqa: E731
        invalid = g(12) if form in PAPER_FORMS else 0  # machines can't cast invalid ballots
        null = sum(g(i) or 0 for i in (16, 19, 23)) if form in PAPER_FORMS else 0
        main[section] = [election_id, section, form, g(5), g(8), g(9), g(10), invalid, null]

    for section, n in machine_null.items():
        if section in main:
            main[section][8] += n
    cur.executemany(
        "INSERT INTO protocols (election_id, section_code, form_num, received_ballots, "
        "registered_voters, added_voters, actual_voters, invalid_votes, null_votes) "
        "VALUES (?,?,?,?,?,?,?,?,?)",
        [tuple(r) for r in main.values()],
    )
    return len(main)


def parse_votes(filepath: str, election_id: int, cur: sqlite3.Cursor) -> int:
    """section;admin_unit; then number;total;paper;machine;machine1;machine2 per ballot."""
    rows = []
    for line in read_lines(filepath):
        p = line.split(";")
        section = p[0].strip()
        for i in range(2, len(p) - 3, 6):
            ballot = safe_int(p[i])
            if ballot is not None:
                rows.append((election_id, section, ballot,
                             safe_int(p[i + 1]) or 0, safe_int(p[i + 2]) or 0, safe_int(p[i + 3]) or 0))
    cur.executemany(
        "INSERT INTO votes (election_id, section_code, party_number, total, paper, machine) "
        "VALUES (?,?,?,?,?,?)",
        rows,
    )
    return len(rows)


def parse_ballots_from_cik_parties(filepath: str, election_id: int, cur: sqlite3.Cursor) -> tuple[int, int]:
    """Fallback when no cik_candidates file ships: ballot;name → party + candidate."""
    parties: list[tuple] = []
    cands: list[tuple] = []
    for line in read_lines(filepath):
        p = line.split(";")
        if len(p) < 2:
            continue
        ballot = safe_int(p[0])
        name = p[1].strip()
        if ballot is None or not name:
            continue
        parties.append((election_id, ballot, name))
        cands.append((election_id, None, ballot, "1", name))
    cur.executemany("INSERT INTO parties (election_id, number, name) VALUES (?,?,?)", parties)
    cur.executemany(
        "INSERT INTO candidates (election_id, rik_code, party_number, list_position, name) "
        "VALUES (?,?,?,?,?)",
        cands,
    )
    return len(parties), len(cands)


def process_election(e: dict, cur: sqlite3.Cursor, results_dir: str) -> dict:
    data_dir = os.path.join(results_dir, e["rel_path"])
    if not os.path.isdir(data_dir):
        return {"error": f"directory not found: {data_dir}"}

    election_id = insert_election(cur, e["slug"], e["name"], e["type"], e["date"], e["round"])
    stats = {"temp_election_id": election_id}

    f = find_file(data_dir, "sections")
    if f:
        stats["sections"] = parse_sections_with_coords(f, election_id, cur)

    f = find_file(data_dir, "cik_candidates")
    if f:
        stats["parties"], stats["candidates"] = parse_president_parties_and_candidates(f, election_id, cur)
    else:
        f = find_file(data_dir, "cik_parties")
        if f:
            stats["parties"], stats["candidates"] = parse_ballots_from_cik_parties(f, election_id, cur)

    f = find_file(data_dir, "protocols")
    if f:
        stats["protocols"] = parse_protocols(f, election_id, cur)

    f = find_file(data_dir, "votes")
    if f:
        stats["votes"] = parse_votes(f, election_id, cur)

    return stats


def parse(db_path: str | None = None, results_dir: str = RESULTS_DIR) -> dict:
    conn, db_path = create_temp_db("pvr202610", db_path)
    cur = conn.cursor()
    cur.execute("ALTER TABLE sections ADD COLUMN lat REAL")
    cur.execute("ALTER TABLE sections ADD COLUMN lng REAL")

    parsed = {}
    for e in ELECTIONS:
        print(f"  → {e['slug']}: {e['name']}")
        stats = process_election(e, cur, results_dir)
        if "error" in stats:
            print(f"    SKIP: {stats['error']}")
            continue
        for k, v in stats.items():
            print(f"    {k}: {v:,}")
        parsed[e["slug"]] = stats["temp_election_id"]

    conn.commit()
    conn.close()
    return {"db_path": db_path, "elections": parsed}


if __name__ == "__main__":
    result = parse()
    print(f"\nTemp DB: {result['db_path']}")
    print(f"Elections: {result['elections']}")
