#!/usr/bin/env python3
"""
pvrns2021.py — Parser for the November 2021 presidential + parliamentary elections.

Three elections:
  pvrns2021_ns     — Народно събрание 14.11.2021
  pvrns2021_pvr_r1 — Президент 14.11.2021
  pvrns2021_pvr_r2 — Президент 21.11.2021

Source: results.cik.bg
Readme: pvrns2021_tur1/np/readme_14.11.2021.txt (same column layout as ns2022)

Protocol format: ns (19-field layout, forms 24/25/26/27/28/29/30/31/32/41)
Votes format:    ns2022_v — sparse stride-2 pairs (party;total) with form-based paper/machine split
                 Form 27/31 control receipts as fallback for sections without form 32/41.
                 Multiple machine lines per section aggregated before insert.
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
        "slug":    "pvrns2021_ns",
        "name":    "Народно събрание 14.11.2021",
        "type":    "parliament",
        "date":    "2021-11-14",
        "round":   1,
        "rel_path": "pvrns2021_tur1/np",
    },
    {
        "slug":    "pvrns2021_pvr_r1",
        "name":    "Президент 14.11.2021",
        "type":    "president",
        "date":    "2021-11-14",
        "round":   1,
        "rel_path": "pvrns2021_tur1/pvr",
    },
    {
        "slug":    "pvrns2021_pvr_r2",
        "name":    "Президент 21.11.2021",
        "type":    "president",
        "date":    "2021-11-21",
        "round":   2,
        "rel_path": "pvrns2021_tur2",
    },
]


# ---------------------------------------------------------------------------
# Protocol parsing — ns format (19 fields)
# ---------------------------------------------------------------------------

def _extract_machine_data(p: list[str]) -> tuple[str, int | None, int | None] | None:
    """
    Extract (section_code, null_votes, total_voted) from machine-only forms (32/41/27/31).

    readme_14.11.2021.txt, Формуляр № 32 (машинно гласуване):
      p[0]  = 1) № формуляр (32)
      p[1]  = 2) Пълен код на секция
      p[16] = 17) 1. Брой гласували                              → total_voted
      p[17] = 18) 2. Действителни гласове за листи               → valid_party
      p[18] = 19) 3. „Не подкрепям никого"                       → null_votes

    Формуляр № 27 (контролни разписки, КР):
      Same field positions as form 32.

    Формуляр № 41 (машинно гласуване от чужбина):
      Same field positions as form 32.

    Формуляр № 31 (контролни разписки от чужбина, ЧКР):
      Same field positions as form 32.
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
    Parse protocols in ns format (19-field layout).

    readme_14.11.2021.txt, Формуляр № 24 (paper-only domestic, Х):
      p[0]  = 1) № формуляр (24)
      p[1]  = 2) Пълен код на секция
      p[2]  = 3) Код на РИК
      p[3]  = 4) Фабрични номера на страниците
      p[4]  = (empty — positions 5,6 skipped)
      p[5]  = (empty)
      p[6]  = 7) А. Брой на получените бюлетини                  → received_ballots
      p[7]  = 8) 1. Брой на избирателите в списъка               → registered_voters
      p[8]  = 9) 2. Брой на вписаните под чертата                 → added_voters
      p[9]  = 10) 3. Брой на гласувалите                          → actual_voters
      p[10] = 11) 4.а) неизползвани бюлетини
      p[11] = 12) 4.б) недействителни/сгрешени бюлетини
      p[12] = (empty — position 13 skipped for form 24)
      p[13] = 14) 5. Намерени в кутията бюлетини
      p[14] = (empty — position 15 skipped for form 24)
      p[15] = 16) 6. Недействителни гласове (бюлетини)            → invalid_votes
      p[16] = 17) 7. Общ брой действителни гласове
      p[17] = 18) 7.1. Действителни гласове за листи
      p[18] = 19) 7.2. „Не подкрепям никого"                      → null_votes

    Формуляр № 25 (machine-confirm, М):
      Same positions up to p[9] (actual_voters).
      p[14] = 15) 5. Потвърдени гласове от машинно гласуване
      No invalid/null fields — these come from form 32 machine data.

    Формуляр № 26 (paper+machine domestic, ХМ):
      Same positions as form 24.
      p[15] = 16) 6. Недействителни гласове                       → invalid_votes
      p[18] = 19) 7.2. „Не подкрепям никого"                      → null_votes

    Forms 28/29/30 (abroad variants): same field layout as 24/25/26.

    Machine-only forms (32/41/27/31) are skipped as primary protocols but their
    null_votes and total_voted are collected for backfilling form 25/29 sections.
    """
    count = 0
    rows = []
    machine_null = {}    # section_code → null_votes from form 32/41
    machine_voted = {}   # section_code → total_voted from form 32/41

    for line in read_lines(filepath):
        p = line.split(";")
        if len(p) < 10:
            continue

        # Collect machine data before skipping machine forms
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
            continue  # machine auxiliary records

        section    = p[1].strip()
        if not section:
            continue

        received   = safe_int(p[6])
        registered = safe_int(p[7])
        added      = safe_int(p[8])
        actual     = safe_int(p[9])
        invalid    = safe_int(p[15]) if len(p) > 15 else None
        null       = safe_int(p[18]) if len(p) > 18 else None

        rows.append((election_id, section, form, received, registered, added, actual, invalid, null))
        count += 1

    cur.executemany(
        "INSERT INTO protocols (election_id, section_code, form_num, received_ballots, "
        "registered_voters, added_voters, actual_voters, invalid_votes, null_votes) "
        "VALUES (?,?,?,?,?,?,?,?,?)",
        rows,
    )

    # Fill in null_votes from machine protocols for sections where paper protocol has none
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
# Votes parsing — ns2022_v format (sparse stride-2 pairs with form-based split)
# ---------------------------------------------------------------------------

def parse_votes(filepath: str, election_id: int, cur: sqlite3.Cursor) -> int:
    """
    Parse votes in ns2022_v format.

    readme_14.11.2021.txt — votes.txt:
      p[0] = 1) № формуляр
      p[1] = 2) Пълен код на секция
      p[2] = 3) Идентификатор на адм. единица
      Then repeating pairs: party_number; total_votes

    Form-based paper/machine split:
      form 24/28       → paper ballots:   paper=total, machine=0
      form 32/41       → machine ballots: paper=0, machine=total
      form 26/30       → combined:        paper=total, machine=0 (paper portion)
                                           + form 32 machine data aggregated separately
      form 27/31       → control receipts: fallback for sections without form 32/41/26/30
                          Only included if section has NO form 32/41/26/30 data.

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
        # Form 27/31 = control receipts from machine voting. Include always:
        # flag=1: machine stopped, voting continued on paper — additional votes
        # flag=2/3: machine data unreadable — replacement votes
        # Aggregation below merges with form 32 data by (section, party).
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

    # Aggregate multiple lines per (election, section, party) — form 32 has one line
    # per machine, form 27 adds control receipt data, form 24 adds paper votes
    agg: dict[tuple, list] = {}
    for r in rows:
        key = (r[0], r[1], r[2])  # election_id, section, party
        if key in agg:
            agg[key][3] += r[3]   # total
            agg[key][4] += r[4]   # paper
            agg[key][5] += r[5]   # machine
        else:
            agg[key] = list(r)
    rows = [tuple(v) for v in agg.values()]
    count = len(rows)

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
    conn, db_path = create_temp_db("pvrns2021", db_path)
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
