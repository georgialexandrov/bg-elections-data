#!/usr/bin/env python3
"""
pe202410.py — Parser for the October 2024 parliamentary elections.

Two elections from the same directory structure:
  pe202410     — Народно събрание 27.10.2024 (standard results)
  pe202410_ks  — Народно събрание 27.10.2024 (КС) (after Constitutional Court decision)

Source: results.cik.bg
Readme: pe202410/Актуализирана база данни/readme_27.10.2024.txt
        pe202410_ks/Актуализирана база данни/readme.txt

Protocol format: ns_pe2024 (19 fields, forms 24/26/28/30 + machine forms 27/31/32/41)
Votes format:    new4  (pe202410) — stride 4: party;total;paper;machine
                 new5  (pe202410_ks) — stride 5: party;total;paper;machine;ks_added
"""

import os
import sqlite3

from parsers.common import (
    RESULTS_DIR, create_temp_db, insert_election,
    find_file, read_lines, safe_int,
    parse_sections, parse_cik_parties, parse_local_candidates, parse_preferences,
)


# ---------------------------------------------------------------------------
# Election metadata
# ---------------------------------------------------------------------------

ELECTIONS = [
    {
        "slug":    "pe202410",
        "name":    "Народно събрание 27.10.2024",
        "type":    "parliament",
        "date":    "2024-10-27",
        "round":   1,
        "rel_path": "pe202410/Актуализирана база данни",
        "votes_stride": 4,  # new4: party;total;paper;machine
    },
    {
        "slug":    "pe202410_ks",
        "name":    "Народно събрание 27.10.2024 (КС)",
        "type":    "parliament",
        "date":    "2024-10-27",
        "round":   1,
        "rel_path": "pe202410_ks/Актуализирана база данни",
        "votes_stride": 5,  # new5: party;total;paper;machine;ks_added
    },
]


# ---------------------------------------------------------------------------
# Protocol parsing — ns_pe2024 format (19 fields)
# ---------------------------------------------------------------------------

def _extract_machine_data(p: list[str]) -> tuple[str, int | None, int | None] | None:
    """
    Extract (section_code, null_votes, total_voted) from machine-only forms (32/41/27/31).

    Machine forms use the same 19-field layout as primary protocols.
    total_voted (p[16]) is used to compute implicit invalid for form 25/29 sections
    where the paper protocol has no invalid field.
    """
    form = safe_int(p[0])
    if form not in (27, 31, 32, 41):
        return None
    section = p[1].strip()
    if not section:
        return None
    ncols = len(p)

    # readme_27.10.2024.txt, machine form layout (same field positions as primary):
    #   p[16] = total_voted (machine voters)
    #   p[17] = null_machine ("Не подкрепям никого" from machine)
    #   p[18] = valid_machine
    null_v      = safe_int(p[18]) if ncols > 18 else None
    total_voted = safe_int(p[16]) if ncols > 16 else None

    if null_v is not None or total_voted is not None:
        return (section, null_v, total_voted)
    return None


def parse_protocols(filepath: str, election_id: int, cur: sqlite3.Cursor) -> int:
    """
    Parse protocols in ns_pe2024 format (19-field layout).

    readme_27.10.2024.txt — Формуляр № 24 (paper-only domestic, Х):
      p[0]  = 1) № формуляр (24)
      p[1]  = 2) Пълен код на секция
      p[2]  = 3) Код на РИК
      p[3]  = 4) Фабрични номера на страниците на протокола
      p[4]  = (empty)
      p[5]  = (empty)
      p[6]  = 7) А. Брой на получените бюлетини                 → received_ballots
      p[7]  = 8) 1. Брой на избирателите в списъка              → registered_voters
      p[8]  = 11) 2. Брой на вписаните под чертата              → added_voters
      p[9]  = 12) 3. Брой на гласувалите избиратели             → actual_voters
      p[10] = 13) 4.а) неизползвани хартиени бюлетини
      p[11] = 14) 4.б) недействителни/сгрешени бюлетини
      p[12] = 15) 5. Намерени в кутията хартиени бюлетини
      p[13] = 16) 6. Недействителни гласове (бюлетини)          → invalid_votes
      p[14] = 17) 7. „Не подкрепям никого" (хартия)             → null_paper
      p[15] = 18) 9. Действителни гласове за листи (хартия)

    Формуляр № 26 (paper+machine domestic, ХМ) — extends form 24 with:
      p[16] = 19) 11. Бюлетини от машинно гласуване
      p[17] = 20) 12. „Не подкрепям никого" (машина)            → null_machine
      p[18] = 21) 14. Действителни гласове за листи (машина)

    Формуляр № 28 (paper-only abroad, ЧХ):
      Same layout as form 24 (fields 1-18).

    Формуляр № 30 (paper+machine abroad, ЧХМ):
      Same layout as form 26 (fields 1-21).

    null_votes = null_paper (p[14]) + null_machine (p[17])
    For paper-only forms (24/28): null_machine is absent, null = null_paper only.

    Machine-only forms (32/41/27/31) are skipped as primary protocols but their
    null_votes and total_voted are collected for backfilling form 25/29 sections.
    """
    count = 0
    rows = []
    machine_null = {}    # section_code → null_votes from form 32/41

    for line in read_lines(filepath):
        p = line.split(";")
        if len(p) < 18:
            continue

        # Collect machine data before skipping machine forms
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
            continue  # machine auxiliary records — not primary protocols

        section    = p[1].strip()
        if not section:
            continue

        received   = safe_int(p[6])
        registered = safe_int(p[7])
        added      = safe_int(p[8])
        actual     = safe_int(p[9])
        invalid    = safe_int(p[13]) if len(p) > 13 else None

        # null_votes = null_paper + null_machine
        null_paper   = safe_int(p[14]) if len(p) > 14 else None
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
# Votes parsing — new4 / new5 format
# ---------------------------------------------------------------------------

def parse_votes(filepath: str, election_id: int, cur: sqlite3.Cursor,
                stride: int = 4) -> int:
    """
    Parse votes in new4/new5 format.

    readme_27.10.2024.txt — votes.txt:
      p[0] = 1) № формуляр
      p[1] = 2) Пълен код на секция
      p[2] = 3) Идентификатор на адм. единица
      Then repeating groups of stride fields per party:
        stride=4 (new4): party_number; total; paper; machine
        stride=5 (new5): party_number; total; paper; machine; ks_added

    pe202410_ks readme.txt — votes.txt:
      Same as above but with 5th field "добавени гласове от решение на КС"
      (votes added by Constitutional Court decision). We ignore this field
      since total already includes them.
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


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def process_election(e: dict, cur: sqlite3.Cursor) -> dict:
    """Process a single pe202410 election. Returns stats dict."""
    data_dir = os.path.join(RESULTS_DIR, e["rel_path"])
    if not os.path.isdir(data_dir):
        return {"error": f"directory not found: {data_dir}"}

    election_id = insert_election(cur, e["slug"], e["name"], e["type"], e["date"], e["round"])
    stats = {}

    # Sections
    f = find_file(data_dir, "sections")
    if f:
        stats["sections"] = parse_sections(f, election_id, cur)

    # Parties
    f = find_file(data_dir, "cik_parties")
    if f:
        stats["parties"] = parse_cik_parties(f, election_id, cur)

    # Candidates
    f = find_file(data_dir, "local_candidates")
    if f:
        stats["candidates"] = parse_local_candidates(f, election_id, cur)

    # Protocols
    f = find_file(data_dir, "protocols")
    if f:
        stats["protocols"] = parse_protocols(f, election_id, cur)

    # Votes
    f = find_file(data_dir, "votes")
    if f:
        stats["votes"] = parse_votes(f, election_id, cur, stride=e["votes_stride"])

    # Preferences
    f = find_file(data_dir, "preferences")
    if f:
        stats["preferences"] = parse_preferences(f, election_id, cur)

    return stats


def parse(db_path: str | None = None) -> dict:
    """
    Parse pe202410 + pe202410_ks into a temp SQLite DB.

    Returns {"db_path": str, "elections": [slug, ...]}
    """
    conn, db_path = create_temp_db("pe202410", db_path)
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
