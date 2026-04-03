#!/usr/bin/env python3
"""
import_geo.py

Three-phase geographic import pipeline:

  1. Schema setup — idempotent DDL for districts, settlements, neighbourhoods,
     plus new columns on riks and locations.

  2. GADM import — downloads Level-1 (districts) and Level-2 (municipalities)
     GeoJSON from geodata.ucdavis.edu, caches them locally, then matches GADM
     features to existing riks rows and stores boundaries + district links.

  3. Settlement build — derives settlements from section_locations by
     aggregating ekatte codes, resolving municipality_id from section_code
     prefixes, and computing centroid Points from linked locations rows.
"""

import json
import re
import sqlite3
import time
import urllib.request
from collections import Counter
from pathlib import Path

DB_PATH = Path(__file__).parent.parent / "elections.db"
GADM_BASE = "https://geodata.ucdavis.edu/gadm/gadm4.1/json"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def step(msg: str) -> None:
    print(f"\n{'='*60}\n{msg}", flush=True)


def timed(label: str, t0: float) -> None:
    print(f"  {label} — done in {time.time() - t0:.1f}s", flush=True)


def column_exists(conn: sqlite3.Connection, table: str, column: str) -> bool:
    rows = conn.execute(f"PRAGMA table_info({table})").fetchall()
    return any(r[1] == column for r in rows)


def safe_alter(conn: sqlite3.Connection, table: str, column: str, typedef: str) -> None:
    if not column_exists(conn, table, column):
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {typedef}")
        print(f"  added column {table}.{column}", flush=True)
    else:
        print(f"  column {table}.{column} already exists, skipping", flush=True)


# ---------------------------------------------------------------------------
# Part 1 — Schema setup
# ---------------------------------------------------------------------------

def setup_schema(conn: sqlite3.Connection) -> None:
    t0 = time.time()
    step("Creating new tables")

    conn.executescript("""
        CREATE TABLE IF NOT EXISTS districts (
            id    INTEGER PRIMARY KEY,
            code  TEXT NOT NULL UNIQUE,
            name  TEXT NOT NULL,
            geo   TEXT
        );

        CREATE TABLE IF NOT EXISTS settlements (
            ekatte          TEXT PRIMARY KEY,
            name            TEXT NOT NULL,
            type            TEXT,
            municipality_id INTEGER REFERENCES riks(id),
            geo             TEXT
        );

        CREATE TABLE IF NOT EXISTS neighbourhoods (
            id     INTEGER PRIMARY KEY,
            name   TEXT NOT NULL,
            ekatte TEXT REFERENCES settlements(ekatte),
            geo    TEXT
        );
    """)

    step("Adding columns to riks and locations")
    safe_alter(conn, "riks", "district_id", "INTEGER REFERENCES districts(id)")
    safe_alter(conn, "riks", "geo", "TEXT")
    safe_alter(conn, "locations", "neighbourhood_id", "INTEGER REFERENCES neighbourhoods(id)")

    conn.commit()
    timed("schema setup", t0)


# ---------------------------------------------------------------------------
# Part 2 — Download + import GADM
# ---------------------------------------------------------------------------

def download_gadm(level: int) -> dict:
    filename = f"gadm41_BGR_{level}.json"
    local = Path(__file__).parent / filename
    url = f"{GADM_BASE}/{filename}"

    if local.exists():
        print(f"  {filename} already cached, skipping download", flush=True)
    else:
        print(f"  downloading {url} ...", flush=True, end=" ")
        t0 = time.time()
        urllib.request.urlretrieve(url, local)
        print(f"done in {time.time() - t0:.1f}s", flush=True)

    with open(local, encoding="utf-8") as fh:
        return json.load(fh)


def import_districts(conn: sqlite3.Connection, l1_data: dict) -> dict[str, int]:
    """
    Insert districts from GADM Level-1 features.
    Returns gid1_to_district_id: {GID_1 -> districts.id}
    """
    t0 = time.time()
    step("Inserting districts")

    inserted = 0
    for feature in l1_data["features"]:
        props = feature["properties"]
        code = props["ISO_1"]          # e.g. "BG-01"
        name = props["NL_NAME_1"]      # Bulgarian name
        geo = json.dumps(feature["geometry"], ensure_ascii=False)

        conn.execute(
            "INSERT OR IGNORE INTO districts (code, name, geo) VALUES (?, ?, ?)",
            (code, name, geo),
        )
        inserted += 1

    conn.commit()
    print(f"  {inserted} districts processed (INSERT OR IGNORE)", flush=True)

    # Build GID_1 -> districts.id map
    code_to_id: dict[str, int] = {
        row[0]: row[1]
        for row in conn.execute("SELECT code, id FROM districts").fetchall()
    }

    gid1_map: dict[str, int] = {}
    for feature in l1_data["features"]:
        props = feature["properties"]
        gid1 = props["GID_1"]   # e.g. "BGR.1_1"
        iso = props["ISO_1"]    # e.g. "BG-01"
        if iso in code_to_id:
            gid1_map[gid1] = code_to_id[iso]

    timed(f"districts — {len(gid1_map)} GID_1 keys mapped", t0)
    return gid1_map


def import_municipalities(
    conn: sqlite3.Connection,
    l2_data: dict,
    gid1_map: dict[str, int],
) -> None:
    """
    Match GADM Level-2 features to riks rows and write geo + district_id.
    """
    t0 = time.time()
    step("Matching municipalities")

    # Build lookup: GID_1 -> list of L2 features
    gid1_features: dict[str, list] = {}
    for feature in l2_data["features"]:
        gid1 = feature["properties"]["GID_1"]
        gid1_features.setdefault(gid1, []).append(feature)

    # Fetch all riks of type municipality
    riks_rows = conn.execute(
        "SELECT id, code, name FROM riks WHERE type = 'municipality'"
    ).fetchall()

    coded_pattern = re.compile(r"^\d{4}\. (.+)$")

    # Precompute per-district name->feature index for fast lookup
    # district_id -> {NL_NAME_2_normalized -> feature}
    # Normalize by stripping all spaces: GADM omits spaces in some names
    # e.g. "ГоцеДелчев" in GADM vs "Гоце Делчев" in riks
    district_name_index: dict[int, dict[str, object]] = {}
    for gid1, features in gid1_features.items():
        did = gid1_map.get(gid1)
        if did is None:
            continue
        district_name_index.setdefault(did, {})
        for feat in features:
            nl2 = feat["properties"].get("NL_NAME_2", "")
            nl2_norm = re.sub(r"\s+", "", nl2)
            district_name_index[did][nl2_norm] = feat

    # Global name (normalized) -> list of features (for bare riks fallback)
    global_name_index: dict[str, list] = {}
    for feature in l2_data["features"]:
        nl2 = feature["properties"].get("NL_NAME_2", "")
        nl2_norm = re.sub(r"\s+", "", nl2)
        global_name_index.setdefault(nl2_norm, []).append(feature)

    coded_district = 0   # got district_id (from section_code convention)
    coded_geo = 0        # got geo polygon (from GADM match)
    coded_total = 0
    bare_matched = 0
    bare_ambiguous = 0
    bare_total = 0

    for rik_id, rik_code, rik_name in riks_rows:
        m = coded_pattern.match(rik_name)

        if m:
            # Coded riks — "XXYY. Name"
            coded_total += 1
            clean_name = m.group(1)
            # Oblast code = first 2 digits of the 4-char zero-padded code
            code_str = str(rik_code).zfill(4)
            oblast_code = code_str[:2]  # "01", "02", ...
            district_iso = f"BG-{oblast_code}"

            # Find district id by ISO code
            did_row = conn.execute(
                "SELECT id FROM districts WHERE code = ?", (district_iso,)
            ).fetchone()
            if did_row is None:
                continue
            did = did_row[0]

            clean_norm = re.sub(r"\s+", "", clean_name)
            feat = district_name_index.get(did, {}).get(clean_norm)

            geo = json.dumps(feat["geometry"], ensure_ascii=False) if feat else None
            conn.execute(
                "UPDATE riks SET geo = ?, district_id = ? WHERE id = ?",
                (geo, did, rik_id),
            )
            coded_district += 1
            if geo is not None:
                coded_geo += 1

        else:
            # Bare riks
            bare_total += 1
            rik_name_norm = re.sub(r"\s+", "", rik_name)
            candidates = global_name_index.get(rik_name_norm, [])
            if len(candidates) == 0:
                continue
            if len(candidates) > 1:
                bare_ambiguous += 1
                continue

            feat = candidates[0]
            geo = json.dumps(feat["geometry"], ensure_ascii=False)
            gid1 = feat["properties"]["GID_1"]
            did = gid1_map.get(gid1)
            conn.execute(
                "UPDATE riks SET geo = ?, district_id = ? WHERE id = ?",
                (geo, did, rik_id),
            )
            bare_matched += 1

    conn.commit()

    print(
        f"  coded riks:  {coded_district}/{coded_total} got district_id"
        f"  ({coded_geo} with geo polygon)",
        flush=True,
    )
    print(
        f"  bare riks:   {bare_matched}/{bare_total} matched"
        f"  ({bare_ambiguous} skipped as ambiguous)",
        flush=True,
    )
    timed("municipality boundaries", t0)


# ---------------------------------------------------------------------------
# Part 3 — Build settlements
# ---------------------------------------------------------------------------

def _settlement_type(name: str) -> str | None:
    if re.search(r"гр\.|ГР\.", name):
        return "city"
    if re.search(r"с\.|С\.", name):
        return "village"
    if re.search(r"к\.|К\.|кв\.", name):
        return "quarter"
    return None


def import_settlements(conn: sqlite3.Connection) -> None:
    t0 = time.time()
    step("Building settlements from section_locations")

    # All distinct (ekatte, settlement_name) pairs — skip null/empty ekatte
    pairs = conn.execute("""
        SELECT DISTINCT ekatte, settlement_name
        FROM section_locations
        WHERE ekatte IS NOT NULL AND ekatte != ''
    """).fetchall()

    print(f"  {len(pairs)} distinct ekatte values found", flush=True)

    # For each ekatte, collect all section_codes to derive municipality_id
    ekatte_sections: dict[str, list[str]] = {}
    for row in conn.execute("""
        SELECT ekatte, section_code
        FROM section_locations
        WHERE ekatte IS NOT NULL AND ekatte != ''
          AND section_code IS NOT NULL
    """).fetchall():
        ekatte_sections.setdefault(row[0], []).append(row[1])

    # Cache riks lookups to avoid N×M queries
    # (code int -> riks.id) for type='municipality'
    # Cast to int — riks.code may be stored as TEXT "101" or INTEGER 101
    riks_cache: dict[int, int] = {
        int(row[0]): row[1]
        for row in conn.execute(
            "SELECT code, id FROM riks WHERE type = 'municipality'"
        ).fetchall()
    }

    # For each ekatte, compute avg lat/lng from joined locations
    ekatte_centroid: dict[str, tuple[float, float]] = {}
    for row in conn.execute("""
        SELECT sl.ekatte, AVG(l.lat), AVG(l.lng)
        FROM section_locations sl
        JOIN locations l ON l.id = sl.location_id
        WHERE sl.ekatte IS NOT NULL AND sl.ekatte != ''
          AND sl.location_id IS NOT NULL
        GROUP BY sl.ekatte
    """).fetchall():
        ekatte_centroid[row[0]] = (row[1], row[2])

    inserted = 0
    with_geo = 0
    with_municipality = 0

    for ekatte, settlement_name in pairs:
        # Derive municipality_id from the most common section_code prefix
        section_codes = ekatte_sections.get(ekatte, [])
        muni_id: int | None = None
        if section_codes:
            candidate_ids: list[int] = []
            for sc in section_codes:
                prefix = sc[:4]
                try:
                    code_int = int(prefix)
                except ValueError:
                    continue
                rid = riks_cache.get(code_int)
                if rid is not None:
                    candidate_ids.append(rid)
            if candidate_ids:
                muni_id = Counter(candidate_ids).most_common(1)[0][0]

        # Centroid geo
        geo: str | None = None
        centroid = ekatte_centroid.get(ekatte)
        if centroid is not None:
            avg_lat, avg_lng = centroid
            geo = json.dumps(
                {"type": "Point", "coordinates": [avg_lng, avg_lat]},
                ensure_ascii=False,
            )

        stype = _settlement_type(settlement_name or "")

        conn.execute(
            """
            INSERT OR IGNORE INTO settlements (ekatte, name, type, municipality_id, geo)
            VALUES (?, ?, ?, ?, ?)
            """,
            (ekatte, settlement_name or "", stype, muni_id, geo),
        )

        inserted += 1
        if geo is not None:
            with_geo += 1
        if muni_id is not None:
            with_municipality += 1

    conn.commit()

    print(f"  settlements inserted (OR IGNORE): {inserted}", flush=True)
    print(f"  with centroid geo:                {with_geo}", flush=True)
    print(f"  with municipality_id:             {with_municipality}", flush=True)
    timed("settlements", t0)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    conn = sqlite3.connect(DB_PATH, timeout=120)  # wait up to 2 min for geocoder write lock
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA journal_mode=WAL")

    print("=== Schema setup ===", flush=True)
    setup_schema(conn)

    print("\n=== Downloading GADM data ===", flush=True)
    l1_data = download_gadm(1)
    l2_data = download_gadm(2)

    print("\n=== Importing districts (Level 1) ===", flush=True)
    gid1_map = import_districts(conn, l1_data)

    print("\n=== Importing municipality boundaries (Level 2) ===", flush=True)
    import_municipalities(conn, l2_data, gid1_map)

    print("\n=== Building settlements ===", flush=True)
    import_settlements(conn)

    conn.commit()
    conn.close()
    print("\nDone.", flush=True)


if __name__ == "__main__":
    main()
