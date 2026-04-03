#!/usr/bin/env python3
"""
europe2024.py — Parser for the June 2024 combined elections (NS + EP).

Two elections:
  europe2024_ns — Народно събрание 09.06.2024
  europe2024_ep — Европейски парламент 09.06.2024

Protocol format: ns2024 / local_new (21-field layout — same positions, differ only in form semantics)
Votes format:    new4 — stride 4: party;total;paper;machine

Key difference from pe202410 (ns_pe2024):
  added at p[10] (not p[8]), actual at p[11] (not p[9])
  null_paper at p[16], null_machine at p[19]
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
        "slug":     "europe2024_ns",
        "name":     "Народно събрание 09.06.2024",
        "type":     "parliament",
        "date":     "2024-06-09",
        "round":    1,
        "rel_path": "europe2024/Актуализирана база данни - НС",
    },
    {
        "slug":     "europe2024_ep",
        "name":     "Европейски парламент 09.06.2024",
        "type":     "european",
        "date":     "2024-06-09",
        "round":    1,
        "rel_path": "europe2024/Актуализирана база данни - ЕП",
    },
]


# ---------------------------------------------------------------------------
# Protocol parsing — ns2024 / local_new format (21 fields)
# ---------------------------------------------------------------------------

def _extract_machine_data(p: list[str]) -> tuple[str, int | None, int | None] | None:
    """
    Extract (section_code, null_votes, total_voted) from machine-only forms (32/41/27/31).
    Same field positions as primary protocols:
      p[16] = total_voted, p[18] = null_votes
    """
    form = safe_int(p[0])
    if form not in (27, 31, 32, 41):
        return None
    section = p[1].strip()
    if not section:
        return None
    ncols = len(p)
    null_v      = safe_int(p[18]) if ncols > 18 else None
    total_voted = safe_int(p[16]) if ncols > 16 else None
    if null_v is not None or total_voted is not None:
        return (section, null_v, total_voted)
    return None


def parse_protocols(filepath: str, election_id: int, cur: sqlite3.Cursor) -> int:
    """
    Parse protocols in ns2024/local_new format (21-field layout).

    Field layout (both ns2024 and local_new use identical positions):
      p[0]  = 1) № формуляр
      p[1]  = 2) Пълен код на секция
      p[2]  = 3) Код на РИК
      p[3]  = 4) Фабрични номера
      p[4]  = (empty)
      p[5]  = (empty)
      p[6]  = 7) А. Брой на получените бюлетини                  → received_ballots
      p[7]  = 8) 1. Брой на избирателите в списъка               → registered_voters
      p[8]  = (empty — position differs from ns_pe2024)
      p[9]  = (empty)
      p[10] = 11) 2. Брой на вписаните под чертата               → added_voters
      p[11] = 12) 3. Брой на гласувалите                          → actual_voters
      p[12] = 13) 4.а) неизползвани бюлетини
      p[13] = 14) 4.б) недействителни/сгрешени бюлетини
      p[14] = 15) 5. Намерени в кутията бюлетини
      p[15] = 16) 6. Недействителни гласове                       → invalid_votes
      p[16] = 17) 7. „Не подкрепям никого" (хартия)              → null_paper
      p[17] = 18) 9. Действителни гласове за листи (хартия)
      p[18] = 19) Бюлетини от машинно гласуване
      p[19] = 20) „Не подкрепям никого" (машина)                 → null_machine
      p[20] = 21) Действителни гласове за листи (машина)

    null_votes = null_paper (p[16]) + null_machine (p[19])
    """
    count = 0
    rows = []
    machine_null = {}

    for line in read_lines(filepath):
        p = line.split(";")
        if len(p) < 12:
            continue

        try:
            md = _extract_machine_data(p)
            if md is not None:
                sec, nv, tv = md
                if nv is not None:
                    machine_null[sec] = machine_null.get(sec, 0) + nv
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
        added      = safe_int(p[10]) if len(p) > 10 else None
        actual     = safe_int(p[11]) if len(p) > 11 else None
        invalid    = safe_int(p[15]) if len(p) > 15 else None

        null_paper   = safe_int(p[16]) if len(p) > 16 else None
        null_machine = safe_int(p[19]) if len(p) > 19 else None
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


# ---------------------------------------------------------------------------
# Votes parsing — new4 format (stride 4)
# ---------------------------------------------------------------------------

def parse_votes(filepath: str, election_id: int, cur: sqlite3.Cursor) -> int:
    """
    Parse votes in new4 format:
      p[0] = № формуляр
      p[1] = Пълен код на секция
      p[2] = Идентификатор на адм. единица
      Then repeating groups of 4: party_number; total; paper; machine
    """
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


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def process_election(e: dict, cur: sqlite3.Cursor) -> dict:
    data_dir = os.path.join(RESULTS_DIR, e["rel_path"])
    if not os.path.isdir(data_dir):
        return {"error": f"directory not found: {data_dir}"}

    election_id = insert_election(cur, e["slug"], e["name"], e["type"], e["date"], e["round"])
    stats = {}

    f = find_file(data_dir, "sections")
    if f:
        stats["sections"] = parse_sections(f, election_id, cur)

    f = find_file(data_dir, "cik_parties")
    if f:
        stats["parties"] = parse_cik_parties(f, election_id, cur)

    f = find_file(data_dir, "local_candidates", "cik_candidates", "candidates")
    if f:
        stats["candidates"] = parse_local_candidates(f, election_id, cur)

    f = find_file(data_dir, "protocols")
    if f:
        stats["protocols"] = parse_protocols(f, election_id, cur)

    f = find_file(data_dir, "votes")
    if f:
        stats["votes"] = parse_votes(f, election_id, cur)

    f = find_file(data_dir, "preferences")
    if f:
        stats["preferences"] = parse_preferences(f, election_id, cur)

    return stats


def parse(db_path: str | None = None) -> dict:
    conn, db_path = create_temp_db("europe2024", db_path)
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
