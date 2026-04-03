#!/usr/bin/env python3
"""
ns2023.py — Parser for the April 2023 parliamentary elections.

One election:
  ns2023 — Народно събрание 02.04.2023

Protocol format: ns2023_f (25-field layout)
Votes format:    new4 — stride 4: party;total;paper;machine
"""

import os
import sqlite3

from parsers.common import (
    RESULTS_DIR, create_temp_db, insert_election,
    find_file, read_lines, safe_int,
    parse_sections, parse_cik_parties, parse_local_candidates, parse_preferences,
)


ELECTIONS = [
    {
        "slug":     "ns2023",
        "name":     "Народно събрание 02.04.2023",
        "type":     "parliament",
        "date":     "2023-04-02",
        "round":    1,
        "rel_path": "ns2023/data_02",
    },
]


def _extract_machine_data(p: list[str]) -> tuple[str, int | None, int | None] | None:
    form = safe_int(p[0])
    if form not in (27, 31, 32, 41):
        return None
    section = p[1].strip()
    if not section:
        return None
    ncols = len(p)
    # Same positions as ns format: p[16]=total_voted, p[18]=null
    null_v      = safe_int(p[18]) if ncols > 18 else None
    total_voted = safe_int(p[16]) if ncols > 16 else None
    if null_v is not None or total_voted is not None:
        return (section, null_v, total_voted)
    return None


def parse_protocols(filepath: str, election_id: int, cur: sqlite3.Cursor) -> int:
    """
    Parse protocols in ns2023_f format (25-field layout).

    Field layout:
      p[0]  = 1) № формуляр
      p[1]  = 2) Пълен код на секция
      p[2]  = 3) Код на РИК
      p[3]  = 4) Фабрични номера
      p[4]  = (empty)
      p[5]  = (empty)
      p[6]  = 7) А. Брой на получените бюлетини                  → received_ballots
      p[7]  = 8) 1. Брой на избирателите в списъка               → registered_voters
      p[8]  = 9) 2. Брой на вписаните под чертата                 → added_voters
      p[9]  = 10) 3. Брой на гласувалите                          → actual_voters
      p[15] = 16) 6. Недействителни гласове                       → invalid_votes

    null_votes at p[24] for form 26 (paper+machine combined null).
    If p[24] is empty, fallback to p[22] (paper-only null for form 24/28).
    """
    count = 0
    rows = []
    machine_null = {}
    machine_voted = {}

    for line in read_lines(filepath):
        p = line.split(";")
        if len(p) < 25:
            continue

        try:
            md = _extract_machine_data(p)
            if md is not None:
                sec, nv, tv = md
                if nv is not None:
                    machine_null[sec] = machine_null.get(sec, 0) + nv
                if tv is not None:
                    machine_voted[sec] = machine_voted.get(sec, 0) + tv
        except (IndexError, ValueError):
            pass

        form = safe_int(p[0])
        if form in (27, 31, 32, 41):
            continue

        section = p[1].strip()
        if not section:
            continue

        received   = safe_int(p[6])
        registered = safe_int(p[7])
        added      = safe_int(p[8])
        actual     = safe_int(p[9])
        invalid    = safe_int(p[15]) if len(p) > 15 else None

        # null: p[24] has combined null for form 26; p[22] is paper-only for form 24/28
        null = safe_int(p[24]) if len(p) > 24 and p[24].strip() else None
        if null is None and len(p) > 22:
            null = safe_int(p[22])  # fallback to paper-only null

        rows.append((election_id, section, form, received, registered, added, actual, invalid, null))
        count += 1

    cur.executemany(
        "INSERT INTO protocols (election_id, section_code, form_num, received_ballots, "
        "registered_voters, added_voters, actual_voters, invalid_votes, null_votes) "
        "VALUES (?,?,?,?,?,?,?,?,?)",
        rows,
    )

    if machine_null:
        updates = [(nv, election_id, sec) for sec, nv in machine_null.items()]
        cur.executemany(
            "UPDATE protocols SET null_votes = ? "
            "WHERE election_id = ? AND section_code = ? AND null_votes IS NULL",
            updates,
        )
    # Form 25/29 (machine-confirm) sections have no invalid field.
    # CIK counts invalid_votes = 0 for these — machines don't produce invalid ballots.
    cur.execute(
        "UPDATE protocols SET invalid_votes = 0 "
        "WHERE election_id = ? AND invalid_votes IS NULL",
        (election_id,),
    )

    return count


def parse_votes(filepath: str, election_id: int, cur: sqlite3.Cursor) -> int:
    count = 0
    rows = []
    for line in read_lines(filepath):
        p = line.split(";")
        if len(p) < 7:
            continue
        section = p[1].strip()
        i = 3
        while i + 3 < len(p):
            party   = safe_int(p[i])
            total   = safe_int(p[i + 1]) or 0
            paper   = safe_int(p[i + 2]) or 0
            machine = safe_int(p[i + 3]) or 0
            if party is not None:
                rows.append((election_id, section, party, total, paper, machine))
                count += 1
            i += 4
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
    if f: stats["sections"] = parse_sections(f, election_id, cur)
    f = find_file(data_dir, "cik_parties")
    if f: stats["parties"] = parse_cik_parties(f, election_id, cur)
    f = find_file(data_dir, "local_candidates")
    if f: stats["candidates"] = parse_local_candidates(f, election_id, cur)
    f = find_file(data_dir, "protocols")
    if f: stats["protocols"] = parse_protocols(f, election_id, cur)
    f = find_file(data_dir, "votes")
    if f: stats["votes"] = parse_votes(f, election_id, cur)
    f = find_file(data_dir, "preferences")
    if f: stats["preferences"] = parse_preferences(f, election_id, cur)
    return stats


def parse(db_path: str | None = None) -> dict:
    conn, db_path = create_temp_db("ns2023", db_path)
    cur = conn.cursor()
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
