#!/usr/bin/env python3
"""
dump_location_cache.py

Snapshots the current `locations` table into `data/location_cache.json` so a
future rebuild can restore GPS coordinates and CIK protocol addresses without
re-running the Google geocoder or the CIK scraper.

Cache format:
    {
      "<ekatte>|<normalized_address>": {
        "lat": float | null,
        "lng": float | null,
        "geocode_source": str | null,
        "protocol_address": str | null
      },
      ...
    }

Run this after `geocode_google.py` or `scrape_cik_addresses.py` has updated the
DB so the cache stays in sync with the latest good state.

    python3 data/dump_location_cache.py
"""

import json
import os
import sqlite3
from pathlib import Path

from normalize_sections import normalize_address  # reuse the canonical normalizer

REPO_ROOT = Path(__file__).parent.parent
DB_PATH = Path(os.environ.get("ELECTIONS_DB", REPO_ROOT / "elections.db"))
CACHE_PATH = Path(__file__).parent / "location_cache.json"


def build_key(ekatte: str | None, address: str | None) -> str:
    ek = (ekatte or "").strip()
    addr_norm = normalize_address(address) if address else ""
    return f"{ek}|{addr_norm}"


def main() -> None:
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()

    # Detect which columns exist (protocol_address may be missing on a fresh rebuild)
    cols = {r[1] for r in cur.execute("PRAGMA table_info(locations)").fetchall()}
    has_proto = "protocol_address" in cols

    select_sql = "SELECT ekatte, address, lat, lng, geocode_source"
    if has_proto:
        select_sql += ", protocol_address"
    select_sql += " FROM locations"

    rows = cur.execute(select_sql).fetchall()
    cache: dict[str, dict] = {}
    for row in rows:
        ekatte   = row[0]
        address  = row[1]
        lat      = row[2]
        lng      = row[3]
        source   = row[4]
        proto    = row[5] if has_proto else None

        if lat is None and lng is None and not proto:
            continue

        key = build_key(ekatte, address)
        if not key or key == "|":
            continue

        # Merge — first write wins; later dup only fills blanks
        entry = cache.get(key)
        if entry is None:
            entry = {
                "lat": lat,
                "lng": lng,
                "geocode_source": source,
                "protocol_address": proto,
            }
            cache[key] = entry
        else:
            if entry["lat"] is None and lat is not None:
                entry["lat"] = lat
                entry["lng"] = lng
                entry["geocode_source"] = source
            if not entry["protocol_address"] and proto:
                entry["protocol_address"] = proto

    with open(CACHE_PATH, "w", encoding="utf-8") as f:
        json.dump(cache, f, ensure_ascii=False, indent=1, sort_keys=True)

    with_coords = sum(1 for e in cache.values() if e["lat"] is not None)
    with_proto  = sum(1 for e in cache.values() if e["protocol_address"])
    print(f"Wrote {CACHE_PATH}")
    print(f"  {len(cache):,} entries")
    print(f"  {with_coords:,} with coordinates")
    print(f"  {with_proto:,} with protocol_address")

    conn.close()


if __name__ == "__main__":
    main()
