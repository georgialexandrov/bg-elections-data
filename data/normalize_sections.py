#!/usr/bin/env python3
"""
normalize_sections.py

Deduplicates polling station data into a `locations` table (one row per
physical building), then links `sections` to locations via location_id.

Before:
  sections(election_id, section_code, rik_code, rik_name, ekatte,
           settlement_name, address, is_mobile, is_ship, machine_count)
  → 574k+ rows, address/settlement repeated ~13x per station

After:
  locations(id PK, ekatte, settlement_name, address)
  → ~9k rows, one per unique (ekatte, address) building

  sections(election_id, section_code, location_id FK, rik_code, rik_name,
           is_mobile, is_ship, machine_count)
  → 574k+ rows, no address duplication

Multiple section_codes at the same building share one location_id.
Canonical values: most frequently used non-empty string per section_code,
then deduplicated by (ekatte, normalized_address).

Safe to re-run: drops and recreates locations, rebuilds sections in-place.
"""

import os
import re
import sqlite3
from pathlib import Path

DB_PATH = Path(os.environ.get("ELECTIONS_DB", Path(__file__).parent.parent / "elections.db"))


def normalize_address(addr: str) -> str:
    """Normalize address for dedup: uppercase, collapse whitespace, strip punctuation noise."""
    s = addr.upper().strip()
    # Remove city/village prefix — "ГР. БАНСКО " or "С. ГОСТУН, "
    s = re.sub(r"^(ГР\.?\s+|С\.?\s+|МИН\.?\s+С\.?\s+|ОБЩ\.?\s+)[А-ЯA-Z\-]+[,\s]*", "", s)
    # Normalize quotes: replace all quote variants with nothing
    s = re.sub(r'["""\'„\u201c\u201d\u201e]', '', s)
    # Normalize № spacing
    s = re.sub(r"№\s*", "№", s)
    # Collapse whitespace
    s = re.sub(r"\s+", " ", s).strip()
    return s


def build_locations(cur: sqlite3.Cursor) -> int:
    """
    Build locations table from sections data.

    1. For each section_code, pick canonical ekatte, settlement_name, address
       (most frequent non-empty value across elections).
    2. Deduplicate by (ekatte, normalized_address) — one location per building.
    3. Map each section_code → location_id.
    """
    # Step 1: canonical values per section_code (same logic as old section_locations)
    print("  Extracting canonical values per section_code...")
    section_data = cur.execute("""
        SELECT
            section_code,
            (SELECT ekatte FROM sections s2
             WHERE s2.section_code = s.section_code
               AND s2.ekatte IS NOT NULL AND s2.ekatte != ''
             GROUP BY ekatte ORDER BY COUNT(*) DESC LIMIT 1),
            (SELECT settlement_name FROM sections s2
             WHERE s2.section_code = s.section_code
               AND s2.settlement_name IS NOT NULL AND s2.settlement_name != ''
             GROUP BY settlement_name ORDER BY COUNT(*) DESC LIMIT 1),
            (SELECT address FROM sections s2
             WHERE s2.section_code = s.section_code
               AND s2.address IS NOT NULL AND s2.address != ''
             GROUP BY address ORDER BY COUNT(*) DESC LIMIT 1)
        FROM sections s
        GROUP BY section_code
    """).fetchall()
    print(f"  {len(section_data):,} unique section_codes")

    # Step 2: deduplicate by (ekatte, normalized_address) → location_id
    # For sections without address, use (ekatte, section_code) as fallback key
    # For sections without ekatte AND address, each gets its own location
    print("  Deduplicating by (ekatte, normalized_address)...")
    loc_map: dict[tuple, int] = {}  # (ekatte, norm_addr) → location_id
    loc_rows: list[tuple] = []      # (id, ekatte, settlement_name, address)
    section_to_loc: dict[str, int] = {}  # section_code → location_id
    next_id = 1

    for section_code, ekatte, settlement_name, address in section_data:
        if address:
            norm = normalize_address(address)
            key = (ekatte or "", norm)
        elif ekatte:
            # No address but has ekatte — group by ekatte only
            # (small villages with one polling station)
            key = (ekatte, "")
        else:
            # No address, no ekatte — unique per section_code
            key = ("", section_code)

        if key not in loc_map:
            loc_map[key] = next_id
            loc_rows.append((next_id, ekatte, settlement_name, address))
            next_id += 1

        section_to_loc[section_code] = loc_map[key]

    print(f"  {len(loc_rows):,} unique locations")

    # Step 3: write to DB
    cur.executescript("""
        DROP TABLE IF EXISTS locations;
        CREATE TABLE locations (
            id              INTEGER PRIMARY KEY,
            ekatte          TEXT,
            settlement_name TEXT,
            address         TEXT
        );
    """)

    cur.executemany(
        "INSERT INTO locations (id, ekatte, settlement_name, address) VALUES (?,?,?,?)",
        loc_rows,
    )

    return section_to_loc


def rebuild_sections(cur: sqlite3.Cursor, section_to_loc: dict[str, int]) -> None:
    """Recreate sections: drop address columns, add location_id FK."""

    cur.executescript("""
        ALTER TABLE sections RENAME TO sections_old;

        CREATE TABLE sections (
            id            INTEGER PRIMARY KEY,
            election_id   INTEGER NOT NULL,
            section_code  TEXT    NOT NULL,
            location_id   INTEGER,
            rik_code      TEXT,
            rik_name      TEXT,
            is_mobile     INTEGER DEFAULT 0,
            is_ship       INTEGER DEFAULT 0,
            machine_count INTEGER DEFAULT 0,
            FOREIGN KEY (election_id) REFERENCES elections(id),
            FOREIGN KEY (location_id) REFERENCES locations(id)
        );

        INSERT INTO sections
               (id, election_id, section_code, rik_code, rik_name,
                is_mobile, is_ship, machine_count)
        SELECT  id, election_id, section_code, rik_code, rik_name,
                is_mobile, is_ship, machine_count
        FROM sections_old;

        DROP TABLE sections_old;

        CREATE INDEX idx_sections_election ON sections(election_id);
        CREATE INDEX idx_sections_code     ON sections(section_code);
        CREATE INDEX idx_sections_location ON sections(location_id);
    """)

    # Set location_id from the mapping
    cur.executemany(
        "UPDATE sections SET location_id = ? WHERE section_code = ?",
        [(loc_id, sec_code) for sec_code, loc_id in section_to_loc.items()],
    )


def print_stats(cur: sqlite3.Cursor) -> None:
    n_locs = cur.execute("SELECT COUNT(*) FROM locations").fetchone()[0]
    n_with_addr = cur.execute(
        "SELECT COUNT(*) FROM locations WHERE address IS NOT NULL AND address != ''"
    ).fetchone()[0]
    n_sections = cur.execute("SELECT COUNT(*) FROM sections").fetchone()[0]
    n_linked = cur.execute("SELECT COUNT(*) FROM sections WHERE location_id IS NOT NULL").fetchone()[0]

    print(f"\n  locations:  {n_locs:>6,} rows  ({n_with_addr:,} with address)")
    print(f"  sections:   {n_sections:>6,} rows  ({n_linked:,} linked to location)")


def main() -> None:
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()

    print("Building locations from sections...")
    section_to_loc = build_locations(cur)

    print("Rebuilding sections table...")
    rebuild_sections(cur, section_to_loc)

    conn.commit()
    print_stats(cur)
    conn.close()


if __name__ == "__main__":
    main()
