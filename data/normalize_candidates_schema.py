#!/usr/bin/env python3
"""
normalize_candidates_schema.py

Post-processing: enriches `candidates` with FK columns and builds lookup tables.

  riks    — geographic units (MIR districts + municipalities)
  persons — deduplicated candidate names

Adds to `candidates`:
  person_id  FK → persons  (NULL when name is absent)
  rik_id     FK → riks     (NULL for president / european — not geographic)

Notes on rik_code semantics:
  parliament  → MIR codes 1-31  (geographic)
  local_*     → municipality codes 101-2826  (geographic)
  european    → party/list number (NOT geographic, rik_id left NULL)
  president   → candidate ordinal (NOT geographic, rik_id left NULL)

Source of truth for rik names: `sections` table (cleaner than candidates).

Safe to re-run: drops/recreates riks + persons, then updates candidates columns.
"""

import os
import sqlite3
from pathlib import Path

DB_PATH = Path(os.environ.get("ELECTIONS_DB", Path(__file__).parent.parent / "elections.db"))

PARLIAMENT_TYPES = {"parliament"}
LOCAL_TYPES = {
    "local_council", "local_mayor",
    "local_mayor_kmetstvo", "local_mayor_neighbourhood",
}


# ---------------------------------------------------------------------------
# Schema
# ---------------------------------------------------------------------------

def create_lookup_tables(cur: sqlite3.Cursor) -> None:
    cur.executescript("""
        DROP TABLE IF EXISTS persons;
        DROP TABLE IF EXISTS riks;

        CREATE TABLE riks (
            id    INTEGER PRIMARY KEY,
            code  TEXT NOT NULL,
            type  TEXT NOT NULL,   -- 'mir' | 'municipality'
            name  TEXT,
            UNIQUE(code, type)
        );

        CREATE TABLE persons (
            id   INTEGER PRIMARY KEY,
            name TEXT NOT NULL UNIQUE
        );
    """)

    # Add FK columns to candidates if they don't exist yet
    existing = {row[1] for row in cur.execute("PRAGMA table_info(candidates)").fetchall()}
    if "person_id" not in existing:
        cur.execute("ALTER TABLE candidates ADD COLUMN person_id INTEGER REFERENCES persons(id)")
    if "rik_id" not in existing:
        cur.execute("ALTER TABLE candidates ADD COLUMN rik_id INTEGER REFERENCES riks(id)")

    # Reset FK columns so re-runs start clean
    cur.execute("UPDATE candidates SET person_id = NULL, rik_id = NULL")


# ---------------------------------------------------------------------------
# Riks
# ---------------------------------------------------------------------------

def build_riks(cur: sqlite3.Cursor) -> int:
    """
    Populate riks from sections (authoritative geographic source).
    For each (rik_code, type) pick the most-frequently-used name.
    """
    mir_rows = cur.execute("""
        SELECT s.rik_code, s.rik_name, COUNT(*) AS cnt
        FROM   sections s
        JOIN   elections e ON e.id = s.election_id
        WHERE  e.type = 'parliament'
          AND  s.rik_code IS NOT NULL
          AND  s.rik_name IS NOT NULL AND s.rik_name != ''
        GROUP  BY s.rik_code, s.rik_name
        ORDER  BY s.rik_code, cnt DESC
    """).fetchall()

    mir_best: dict[str, str] = {}
    for code, name, _ in mir_rows:
        mir_best.setdefault(code, name)

    mun_rows = cur.execute("""
        SELECT s.rik_code, s.rik_name, COUNT(*) AS cnt
        FROM   sections s
        JOIN   elections e ON e.id = s.election_id
        WHERE  e.type IN ('local_council','local_mayor',
                          'local_mayor_kmetstvo','local_mayor_neighbourhood')
          AND  s.rik_code IS NOT NULL
          AND  s.rik_name IS NOT NULL AND s.rik_name != ''
        GROUP  BY s.rik_code, s.rik_name
        ORDER  BY s.rik_code, cnt DESC
    """).fetchall()

    mun_best: dict[str, str] = {}
    for code, name, _ in mun_rows:
        mun_best.setdefault(code, name)

    rows = (
        [(code, "mir",          name) for code, name in sorted(mir_best.items(), key=lambda x: int(x[0]))]
        + [(code, "municipality", name) for code, name in sorted(mun_best.items(), key=lambda x: int(x[0]) if x[0].isdigit() else 9999)]
    )
    cur.executemany("INSERT OR IGNORE INTO riks (code, type, name) VALUES (?,?,?)", rows)
    return len(rows)


# ---------------------------------------------------------------------------
# Persons + FK columns on candidates
# ---------------------------------------------------------------------------

def build_persons(cur: sqlite3.Cursor) -> int:
    names = cur.execute(
        "SELECT DISTINCT name FROM candidates WHERE name IS NOT NULL AND name != ''"
    ).fetchall()
    cur.executemany("INSERT OR IGNORE INTO persons (name) VALUES (?)", names)
    return len(names)


def update_candidate_fks(cur: sqlite3.Cursor) -> None:
    person_map: dict[str, int] = {
        row[0]: row[1]
        for row in cur.execute("SELECT name, id FROM persons").fetchall()
    }
    rik_map: dict[tuple[str, str], int] = {
        (row[1], row[2]): row[0]
        for row in cur.execute("SELECT id, code, type FROM riks").fetchall()
    }

    rows = cur.execute("""
        SELECT c.id, e.type, c.rik_code, c.name
        FROM   candidates c
        JOIN   elections  e ON e.id = c.election_id
    """).fetchall()

    updates = []
    for cid, etype, rik_code, name in rows:
        person_id = person_map.get(name) if name else None

        rik_id = None
        if rik_code:
            if etype in PARLIAMENT_TYPES:
                rik_id = rik_map.get((rik_code, "mir"))
            elif etype in LOCAL_TYPES:
                rik_id = rik_map.get((rik_code, "municipality"))

        updates.append((person_id, rik_id, cid))

    cur.executemany(
        "UPDATE candidates SET person_id = ?, rik_id = ? WHERE id = ?",
        updates,
    )


# ---------------------------------------------------------------------------
# Stats
# ---------------------------------------------------------------------------

def print_stats(cur: sqlite3.Cursor) -> None:
    total_cand    = cur.execute("SELECT COUNT(*) FROM candidates").fetchone()[0]
    total_persons = cur.execute("SELECT COUNT(*) FROM persons").fetchone()[0]
    total_riks    = cur.execute("SELECT COUNT(*) FROM riks").fetchone()[0]

    print("\n=== Table sizes ===")
    print(f"  candidates:              {total_cand:>8}")
    print(f"  persons (unique names):  {total_persons:>8}  ({total_cand/total_persons:.1f}x dedup)")
    print(f"  riks:                    {total_riks:>8}")

    print("\n=== Riks breakdown ===")
    for row in cur.execute("SELECT type, COUNT(*) FROM riks GROUP BY type").fetchall():
        print(f"  {row[0]:<15} {row[1]}")

    print("\n=== Cross-election name matches ===")
    dist = cur.execute("""
        SELECT election_count, COUNT(*) AS person_count
        FROM (
            SELECT p.id, COUNT(DISTINCT c.election_id) AS election_count
            FROM   persons p
            JOIN   candidates c ON c.person_id = p.id
            GROUP  BY p.id
        )
        GROUP  BY election_count
        ORDER  BY election_count
    """).fetchall()
    multi = sum(cnt for e, cnt in dist if e > 1)
    print(f"  Names in exactly 1 election: {next((c for e,c in dist if e==1), 0):>7}")
    print(f"  Names in 2+ elections:       {multi:>7}  (exact-match, may be different people)")
    print()
    for e_count, p_count in dist:
        print(f"  {e_count:>2} elections: {p_count:>7}  {'█' * min(e_count, 20)}")

    print("\n=== Top repeated names ===")
    top = cur.execute("""
        SELECT p.name, COUNT(DISTINCT c.election_id) AS elections
        FROM   persons p
        JOIN   candidates c ON c.person_id = p.id
        GROUP  BY p.id
        ORDER  BY elections DESC
        LIMIT  10
    """).fetchall()
    for name, elections in top:
        print(f"  {elections:>2}x  {name}")

    avg_name_len = cur.execute("SELECT AVG(LENGTH(name)) FROM persons").fetchone()[0] or 0
    saved = (total_cand - total_persons) * (avg_name_len - 4)
    print(f"\n=== Estimated name dedup saving ===")
    print(f"  Avg name length: {avg_name_len:.0f} chars  →  ~{saved/1024:.0f} KB")


# ---------------------------------------------------------------------------

def main() -> None:
    conn = sqlite3.connect(DB_PATH)
    cur  = conn.cursor()

    print("Creating lookup tables + adding FK columns to candidates…")
    create_lookup_tables(cur)

    print("Building riks…")
    n = build_riks(cur)
    print(f"  {n} entries")

    print("Building persons…")
    n_p = build_persons(cur)
    print(f"  {n_p} unique names")

    print("Updating candidates FKs…")
    update_candidate_fks(cur)

    conn.commit()
    print_stats(cur)
    conn.close()


if __name__ == "__main__":
    main()
