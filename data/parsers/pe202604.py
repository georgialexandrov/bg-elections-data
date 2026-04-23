#!/usr/bin/env python3
"""
pe202604.py — Parser for the April 2026 parliamentary elections.

Source: results.cik.bg/pe202604/opendata/export.zip

The sections file in this export is the first CIK release to carry official
polling-place coordinates inline:

    section;rik_id;rik_name;ekatte;settlement;address;lat;lon;mobile;ship;machines

The 11-field layout is handled locally (common.parse_sections would mis-read
fields 7-10). Coords are stored in two extra columns on the temp sections
table so the incremental integrator (`import_pe202604.py`) can push them
into `locations.lat / locations.lng` without calling the Google geocoder.

Protocol format: forms 24/26/28/30 (no machine-aux 27/31/32/41 or 25/29).
Votes format:    new4 — stride 4 per party: number;total;paper;machine.
"""

import os
import sqlite3

from parsers.common import (
    RESULTS_DIR, create_temp_db, insert_election,
    find_file, read_lines, safe_int,
    parse_cik_parties, parse_local_candidates, parse_preferences,
)


ELECTIONS = [
    {
        "slug":    "pe202604",
        "name":    "Народно събрание 19.04.2026",
        "type":    "parliament",
        "date":    "2026-04-19",
        "round":   1,
        "rel_path": "pe202604",
        "votes_stride": 4,
    },
]


def parse_sections_with_coords(filepath: str, election_id: int, cur: sqlite3.Cursor) -> int:
    """
    pe202604 sections.txt:
      p[0]  section_code
      p[1]  rik_code
      p[2]  rik_name
      p[3]  ekatte
      p[4]  settlement
      p[5]  address
      p[6]  longitude
      p[7]  latitude
      p[8]  is_mobile
      p[9]  is_ship
      p[10] machine_count

    CIK publishes the coordinates in (longitude, latitude) order in the text
    file — confirmed against .internal/external-coords/cik-map-pe202604.json.
    """
    count = 0
    rows = []
    for line in read_lines(filepath):
        p = line.split(";")
        if len(p) < 11:
            continue
        section_code = p[0].strip()
        rik_code     = p[1].strip()
        rik_name     = p[2].strip()
        ekatte       = p[3].strip()
        settlement   = p[4].strip()
        address      = p[5].strip()
        lon          = _safe_float(p[6])
        lat          = _safe_float(p[7])
        is_mobile    = safe_int(p[8]) or 0
        is_ship      = safe_int(p[9]) or 0
        machines     = safe_int(p[10]) or 0

        rows.append((
            election_id, section_code, rik_code, rik_name, ekatte,
            settlement, address, is_mobile, is_ship, machines, lat, lon,
        ))
        count += 1

    cur.executemany(
        "INSERT INTO sections (election_id, section_code, rik_code, rik_name, ekatte, "
        "settlement_name, address, is_mobile, is_ship, machine_count, lat, lng) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        rows,
    )
    return count


def _safe_float(val):
    if val is None:
        return None
    s = str(val).strip()
    if not s:
        return None
    try:
        return float(s)
    except ValueError:
        return None


def parse_protocols(filepath: str, election_id: int, cur: sqlite3.Cursor) -> int:
    """
    Protocol layout — identical for forms 24/26/28/30, 19 fields total.

    readme_19.04.2026.txt:
      p[0]  form number (24/26/28/30)
      p[1]  section_code
      p[2]  rik_code
      p[3]  factory page numbers
      p[4]  (empty — field 5)
      p[5]  (empty — field 6)
      p[6]  received_ballots       (А)
      p[7]  registered_voters      (Б)
      p[8]  added_voters           (1)
      p[9]  actual_voters          (2)
      p[10] unused_paper           (3)
      p[11] destroyed              (4)
      p[12] paper_in_box_total     (5)
      p[13] invalid_votes          (6)
      p[14] null_paper             (7)
      p[15] valid_paper            (9)
      p[16] machine_in_box_total   (11, forms 26/30 only)
      p[17] null_machine           (12, forms 26/30 only)
      p[18] valid_machine          (14, forms 26/30 only)
    """
    count = 0
    rows = []

    for line in read_lines(filepath):
        p = line.split(";")
        if len(p) < 16:
            continue

        form = safe_int(p[0])
        if form not in (24, 26, 28, 30):
            continue

        section = p[1].strip()
        if not section:
            continue

        received   = safe_int(p[6])
        registered = safe_int(p[7])
        added      = safe_int(p[8])
        actual     = safe_int(p[9])
        invalid    = safe_int(p[13])
        null_paper   = safe_int(p[14])
        null_machine = safe_int(p[17]) if len(p) > 17 else None
        null = (
            (null_paper or 0) + (null_machine or 0)
            if (null_paper is not None or null_machine is not None)
            else None
        )

        rows.append((election_id, section, form, received, registered, added, actual, invalid, null))
        count += 1

    cur.executemany(
        "INSERT INTO protocols (election_id, section_code, form_num, received_ballots, "
        "registered_voters, added_voters, actual_voters, invalid_votes, null_votes) "
        "VALUES (?,?,?,?,?,?,?,?,?)",
        rows,
    )
    return count


def parse_votes(filepath: str, election_id: int, cur: sqlite3.Cursor,
                stride: int = 4) -> int:
    """
    votes.txt (new4 format):
      p[0]  form number
      p[1]  section_code
      p[2]  rik_code / area identifier
      Then repeating groups of `stride` fields per party:
        party_number; total; paper; machine
    """
    count = 0
    rows = []

    for line in read_lines(filepath):
        p = line.split(";")
        if len(p) < 7:
            continue

        section = p[1].strip()
        i = 3
        while i + stride - 1 < len(p):
            party   = safe_int(p[i])
            total   = safe_int(p[i + 1]) or 0
            paper   = safe_int(p[i + 2]) or 0
            machine = safe_int(p[i + 3]) or 0
            if party is not None:
                rows.append((election_id, section, party, total, paper, machine))
                count += 1
            i += stride

    cur.executemany(
        "INSERT INTO votes (election_id, section_code, party_number, total, paper, machine) "
        "VALUES (?,?,?,?,?,?)",
        rows,
    )
    return count


def process_election(e: dict, cur: sqlite3.Cursor) -> dict:
    data_dir = os.path.join(RESULTS_DIR, e["rel_path"])
    if not os.path.isdir(data_dir):
        return {"error": f"directory not found: {data_dir}"}

    election_id = insert_election(cur, e["slug"], e["name"], e["type"], e["date"], e["round"])
    stats = {}

    f = find_file(data_dir, "sections")
    if f:
        stats["sections"] = parse_sections_with_coords(f, election_id, cur)

    f = find_file(data_dir, "cik_parties")
    if f:
        stats["parties"] = parse_cik_parties(f, election_id, cur)

    f = find_file(data_dir, "local_candidates")
    if f:
        stats["candidates"] = parse_local_candidates(f, election_id, cur)

    f = find_file(data_dir, "protocols")
    if f:
        stats["protocols"] = parse_protocols(f, election_id, cur)

    f = find_file(data_dir, "votes")
    if f:
        stats["votes"] = parse_votes(f, election_id, cur, stride=e["votes_stride"])

    f = find_file(data_dir, "preferences")
    if f:
        stats["preferences"] = parse_preferences(f, election_id, cur)

    return stats


def parse(db_path: str | None = None) -> dict:
    conn, db_path = create_temp_db("pe202604", db_path)
    cur = conn.cursor()

    # Temp-schema extension: CIK now ships coordinates inline in sections.txt.
    # The integrator reads these back to populate locations.lat / locations.lng
    # without re-geocoding. Columns absent from common.SCHEMA — add here.
    cur.execute("ALTER TABLE sections ADD COLUMN lat REAL")
    cur.execute("ALTER TABLE sections ADD COLUMN lng REAL")

    slugs = []
    for e in ELECTIONS:
        print(f"  → {e['slug']}: {e['name']}")
        stats = process_election(e, cur)
        if "error" in stats:
            print(f"    SKIP: {stats['error']}")
        else:
            for k, v in stats.items():
                print(f"    {k}: {v:,}")
            slugs.append(e["slug"])

    conn.commit()
    conn.close()
    return {"db_path": db_path, "elections": slugs}


if __name__ == "__main__":
    result = parse()
    print(f"\nTemp DB: {result['db_path']}")
    print(f"Elections: {result['elections']}")
