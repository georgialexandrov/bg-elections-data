#!/usr/bin/env python3
"""
import_locations.py

Imports GPS coordinates into the existing `locations` table by matching
addresses from voting_locations.sql to locations.address.

  Source:  voting_locations.sql (TablePlus export, covers ~80% of domestic stations)
  Updates: locations.lat, locations.lng

Matching strategy: word-overlap similarity between locations.address
and voting_locations.cik_address. Accepts matches with Jaccard ≥ 0.5 and
at least 3 shared content words. Skips ambiguous cases.

Run after normalize_sections.py:
    python3 import_locations.py [/path/to/voting_locations.sql]
"""

import os
import re
import sqlite3
import sys
from pathlib import Path

DB_PATH = Path(os.environ.get("ELECTIONS_DB", Path(__file__).parent.parent / "elections.db"))
LOCATION_SQL_DEFAULT = Path(__file__).parent / "voting_locations.sql"

# Words that carry no geographic signal — ignored during matching
STOP_WORDS = {
    "ГР", "С", "КВ", "УЛ", "БУЛ", "ПЛ", "БЛ", "АП",
    "НА", "И", "В", "ДО", "ЗА", "ОТ", "КЪМ", "ПРИ",
    "УЛИЦА", "БУЛЕВАРД", "ПЛОЩАД", "БЛОК",
}


def parse_voting_locations(sql_path: Path) -> list[tuple[str, float, float]]:
    """Parse (cik_address, lat, lng) rows from the TablePlus SQL dump."""
    rows = []
    content = sql_path.read_text(encoding="utf-8", errors="replace")
    for line in content.splitlines():
        line = line.strip()
        if not line.startswith("('"):
            continue
        try:
            vals = re.findall(r"'([^']*)'|NULL", line)
            if len(vals) < 6:
                continue
            cik_addr = vals[2] if vals[2] != "NULL" else ""
            lat_s = vals[4] if vals[4] != "NULL" else ""
            lng_s = vals[5] if vals[5] != "NULL" else ""
            if cik_addr and lat_s and lng_s:
                rows.append((cik_addr.strip(), float(lat_s), float(lng_s)))
        except (ValueError, IndexError):
            continue
    return rows


def content_words(address: str) -> frozenset[str]:
    """Extract content words: uppercase, strip punctuation and stop words."""
    s = address.upper().strip()
    s = re.sub(r"^(ГР\.?\s+|С\.?\s+|ОБЩ\.?\s+|РАЙОН\s+)[А-Я\-]+[,\s]+", "", s)
    s = re.sub(r"№\s*", "", s)
    s = re.sub(r"[^А-ЯA-Z0-9 ]", " ", s)
    words = set(s.split())
    return frozenset(words - STOP_WORDS)


def jaccard(a: frozenset, b: frozenset) -> float:
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def main() -> None:
    sql_path = Path(sys.argv[1]) if len(sys.argv) > 1 else LOCATION_SQL_DEFAULT
    if not sql_path.exists():
        print(f"ERROR: {sql_path} not found.")
        print("Usage: python3 import_locations.py [/path/to/voting_locations.sql]")
        sys.exit(1)

    print(f"Parsing {sql_path} …")
    vl_rows = parse_voting_locations(sql_path)
    print(f"  {len(vl_rows):,} rows loaded")

    # Deduplicate GPS by (lat, lng) rounded to 5 decimals
    gps_by_coord: dict[tuple, str] = {}
    for cik_addr, lat, lng in vl_rows:
        key = (round(lat, 5), round(lng, 5))
        if key not in gps_by_coord:
            gps_by_coord[key] = cik_addr

    print(f"  {len(gps_by_coord):,} unique GPS coordinates")

    # Build search index: words(cik_address) → list of (cik_address, lat, lng)
    vl_by_words: dict[frozenset, list[tuple[str, float, float]]] = {}
    for cik_addr, lat, lng in vl_rows:
        key = content_words(cik_addr)
        if key:
            vl_by_words.setdefault(key, []).append((cik_addr, lat, lng))

    print("\nConnecting to database …")
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()

    # Add lat/lng columns if not present
    existing = {row[1] for row in cur.execute("PRAGMA table_info(locations)").fetchall()}
    if "lat" not in existing:
        cur.execute("ALTER TABLE locations ADD COLUMN lat REAL")
    if "lng" not in existing:
        cur.execute("ALTER TABLE locations ADD COLUMN lng REAL")
    conn.commit()

    # Reset GPS data
    cur.execute("UPDATE locations SET lat = NULL, lng = NULL")

    # Load locations that have addresses
    locs = cur.execute(
        "SELECT id, address FROM locations WHERE address IS NOT NULL AND address != ''"
    ).fetchall()

    matched = 0
    ambiguous = 0
    unmatched = 0
    updates = []

    for loc_id, address in locs:
        loc_words = content_words(address)
        if not loc_words:
            unmatched += 1
            continue

        best_score = 0.0
        best_key = None
        second_best = 0.0

        for vl_words, vl_list in vl_by_words.items():
            score = jaccard(loc_words, vl_words)
            if score > best_score:
                second_best = best_score
                best_score = score
                best_key = vl_words
            elif score > second_best:
                second_best = score

        if best_score >= 0.5 and best_key and len(loc_words & best_key) >= 3:
            if best_score == second_best:
                ambiguous += 1
                continue
            vl_entry = vl_by_words[best_key][0]
            lat, lng = vl_entry[1], vl_entry[2]
            updates.append((lat, lng, loc_id))
            matched += 1
        else:
            unmatched += 1

    cur.executemany("UPDATE locations SET lat = ?, lng = ? WHERE id = ?", updates)
    conn.commit()

    total = len(locs)
    print(f"\nLocations with address: {total:,}")
    print(f"  GPS matched:     {matched:,}  ({matched/max(total,1)*100:.1f}%)")
    print(f"  Ambiguous (skip): {ambiguous:,}")
    print(f"  Unmatched:        {unmatched:,}")

    n_with_gps = cur.execute("SELECT COUNT(*) FROM locations WHERE lat IS NOT NULL").fetchone()[0]
    n_total = cur.execute("SELECT COUNT(*) FROM locations").fetchone()[0]
    print(f"\nTotal locations: {n_total:,}  ({n_with_gps:,} with GPS)")

    conn.close()
    print("\nDone.")


if __name__ == "__main__":
    main()
