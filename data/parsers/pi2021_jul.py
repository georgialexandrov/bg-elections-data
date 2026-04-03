#!/usr/bin/env python3
"""
pi2021_jul.py — Parser for July 2021 parliamentary elections.

One election:
  pi2021_jul — Народно събрание 11.07.2021

Protocol format: old_short (17-col variant — p[4]=received, p[5]=registered, p[6]=added, p[7]=actual)
Votes format:    sparse_form — form;section;rik;[party;total]+
"""

import os
import sqlite3

from parsers.common import (
    RESULTS_DIR, create_temp_db, insert_election,
    find_file, read_lines, safe_int,
    parse_sections, parse_cik_parties, parse_local_candidates,
)


ELECTIONS = [
    {
        "slug":     "pi2021_jul",
        "name":     "Народно събрание 11.07.2021",
        "type":     "parliament",
        "date":     "2021-07-11",
        "round":    1,
        "rel_path": "pi2021_07",
    },
]


def _extract_machine_data(p: list[str]) -> tuple[str, int | None, int | None] | None:
    """Machine data for old_short 17-col: p[14]=total_voted, p[16]=null"""
    form = safe_int(p[0])
    if form not in (27, 31, 32, 41):
        return None
    section = p[1].strip()
    if not section:
        return None
    ncols = len(p)
    if ncols <= 17:
        null_v      = safe_int(p[16]) if ncols > 16 else None
        total_voted = safe_int(p[14]) if ncols > 14 else None
        if null_v is not None or total_voted is not None:
            return (section, null_v, total_voted)
    return None


def parse_protocols(filepath: str, election_id: int, cur: sqlite3.Cursor) -> int:
    """
    old_short 17-col layout (pi2021_jul):
      p[0]  = № формуляр
      p[1]  = Пълен код на секция
      p[4]  = received_ballots
      p[5]  = registered_voters
      p[6]  = added_voters
      p[7]  = actual_voters
      p[13] = invalid_votes
      p[16] = null_votes ("Не подкрепям никого")
    """
    count = 0
    rows = []
    machine_null = {}
    machine_voted = {}

    for line in read_lines(filepath):
        p = line.split(";")
        if len(p) < 8:
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

        received   = safe_int(p[4])
        registered = safe_int(p[5])
        added      = safe_int(p[6])
        actual     = safe_int(p[7])
        invalid    = safe_int(p[13]) if len(p) > 13 else None
        null       = safe_int(p[16]) if len(p) > 16 else None

        rows.append((election_id, section, form, received, registered, added, actual, invalid, null))
        count += 1

    cur.executemany(
        "INSERT INTO protocols (election_id, section_code, form_num, received_ballots, "
        "registered_voters, added_voters, actual_voters, invalid_votes, null_votes) "
        "VALUES (?,?,?,?,?,?,?,?,?)",
        rows,
    )
    if machine_null:
        cur.executemany("UPDATE protocols SET null_votes = ? WHERE election_id = ? AND section_code = ? AND null_votes IS NULL",
                        [(nv, election_id, sec) for sec, nv in machine_null.items()])
    # Form 25/29 (machine-confirm) sections have no invalid field.
    # CIK counts invalid_votes = 0 for these — machines don't produce invalid ballots.
    cur.execute(
        "UPDATE protocols SET invalid_votes = 0 "
        "WHERE election_id = ? AND invalid_votes IS NULL",
        (election_id,),
    )


    return count


def parse_votes(filepath: str, election_id: int, cur: sqlite3.Cursor) -> int:
    """
    ns2022_v format: form;section;rik;[party;total]+

    Form-based paper/machine split:
      form 24/28       → paper ballots:   paper=total, machine=0
      form 32/41       → machine ballots: paper=0, machine=total
      form 26/30       → combined:        paper=total, machine=0 (paper portion)
      form 27/31       → control receipts: fallback for sections without form 32/41/26/30

    Multiple machine lines per section (one per machine) are aggregated before insert.
    """
    count = 0
    rows = []

    for line in read_lines(filepath):
        p = line.split(";")
        if len(p) < 5:
            continue

        form = safe_int(p[0])
        section = p[1].strip()

        is_machine = form in (32, 41)
        is_control = form in (27, 31)

        i = 3
        while i + 1 < len(p):
            party = safe_int(p[i])
            total = safe_int(p[i + 1]) or 0
            if party is not None:
                paper   = total if not (is_machine or is_control) else 0
                machine = total if (is_machine or is_control) else 0
                rows.append((election_id, section, party, total, paper, machine))
                count += 1
            i += 2

    agg: dict[tuple, list] = {}
    for r in rows:
        key = (r[0], r[1], r[2])
        if key in agg:
            agg[key][3] += r[3]
            agg[key][4] += r[4]
            agg[key][5] += r[5]
        else:
            agg[key] = list(r)
    rows = [tuple(v) for v in agg.values()]
    count = len(rows)

    cur.executemany(
        "INSERT INTO votes (election_id, section_code, party_number, total, paper, machine) VALUES (?,?,?,?,?,?)",
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
    # votes file: find "votes" but exclude "votes_mv"
    for fname in sorted(os.listdir(data_dir)):
        if "votes" in fname.lower() and "votes_mv" not in fname.lower() and fname.endswith(".txt"):
            stats["votes"] = parse_votes(os.path.join(data_dir, fname), election_id, cur)
            break
    return stats


def parse(db_path: str | None = None) -> dict:
    conn, db_path = create_temp_db("pi2021_jul", db_path)
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
