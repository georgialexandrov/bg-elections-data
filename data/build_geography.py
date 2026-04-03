#!/usr/bin/env python3
"""
build_geography.py

Builds the geography tables from GRAO data:
  - Rebuilds districts with numeric IDs matching BG-XX codes (no code column)
  - Creates and populates municipalities (265 общини)
  - Creates and populates kmetstva (all settlements as election units)
  - Creates and populates local_regions (35 районни in Sofia/Plovdiv/Varna)
  - Cleans up riks: keeps only 32 МИР rows, renames code→oik_prefix

Source: https://www.grao.bg/tna/tab02.txt (CP1251 encoded)
Run from the results/ directory.
"""

import re
import sqlite3
import subprocess
import time
from pathlib import Path

DB_PATH = Path(__file__).parent.parent / "elections.db"
GRAO_URL = "https://www.grao.bg/tna/tab02.txt"
GRAO_CACHE = Path(__file__).parent / "grao_tab02.txt"

# GRAO oblast name (Cyrillic uppercase) → numeric district id
# id = int(BG-XX code suffix); Sofia-grad (GADM stores as 'NA') → 22
GRAO_TO_DISTRICT_ID: dict[str, int] = {
    "БЛАГОЕВГРАД":    1,
    "БУРГАС":         2,
    "ВАРНА":          3,
    "ВЕЛИКО ТЪРНОВО": 4,
    "ВИДИН":          5,
    "ВРАЦА":          6,
    "ГАБРОВО":        7,
    "ДОБРИЧ":         8,
    "КЪРДЖАЛИ":       9,
    "КЮСТЕНДИЛ":     10,
    "ЛОВЕЧ":         11,
    "МОНТАНА":       12,
    "ПАЗАРДЖИК":     13,
    "ПЕРНИК":        14,
    "ПЛЕВЕН":        15,
    "ПЛОВДИВ":       16,
    "РАЗГРАД":       17,
    "РУСЕ":          18,
    "СИЛИСТРА":      19,
    "СЛИВЕН":        20,
    "СМОЛЯН":        21,
    "СОФИЯ":         22,   # Sofia-grad (GADM code NA)
    "СОФИЙСКА":      23,   # Sofia Oblast (GADM code BG-23)
    "СТАРА ЗАГОРА":  24,
    "ТЪРГОВИЩЕ":     25,
    "ХАСКОВО":       26,
    "ШУМЕН":         27,
    "ЯМБОЛ":         28,
}

# GRAO oblast name → correct Bulgarian district name
DISTRICT_NAME_FIX: dict[str, str] = {
    "БЛАГОЕВГРАД":    "Благоевград",
    "БУРГАС":         "Бургас",
    "ВАРНА":          "Варна",
    "ВЕЛИКО ТЪРНОВО": "Велико Търново",
    "ВИДИН":          "Видин",
    "ВРАЦА":          "Враца",
    "ГАБРОВО":        "Габрово",
    "ДОБРИЧ":         "Добрич",
    "КЪРДЖАЛИ":       "Кърджали",
    "КЮСТЕНДИЛ":      "Кюстендил",
    "ЛОВЕЧ":          "Ловеч",
    "МОНТАНА":        "Монтана",
    "ПАЗАРДЖИК":      "Пазарджик",
    "ПЕРНИК":         "Перник",
    "ПЛЕВЕН":         "Плевен",
    "ПЛОВДИВ":        "Пловдив",
    "РАЗГРАД":        "Разград",
    "РУСЕ":           "Русе",
    "СИЛИСТРА":       "Силистра",
    "СЛИВЕН":         "Сливен",
    "СМОЛЯН":         "Смолян",
    "СОФИЯ":          "София-град",
    "СОФИЙСКА":       "Софийска",
    "СТАРА ЗАГОРА":   "Стара Загора",
    "ТЪРГОВИЩЕ":      "Търговище",
    "ХАСКОВО":        "Хасково",
    "ШУМЕН":          "Шумен",
    "ЯМБОЛ":          "Ямбол",
}

# GRAO municipality name → riks name (for cases where names differ)
MUNICIPALITY_NAME_ALIAS: dict[str, str] = {
    "ДОБРИЧ-ГРАД": "ДОБРИЧ",
}

# Settlement type prefix → single-char type: c=city, v=village, q=quarter
SETTLEMENT_TYPE: dict[str, str] = {
    "ГР": "c",
    "С":  "v",
    "КВ": "q",
    "М":  "v",   # махала — functionally a village
    "К":  "v",   # колиби — village
}

# Population below which settlement gets кметски наместник (k=kmet, n=namestnik)
NAMESTNIK_THRESHOLD = 350


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def step(msg: str) -> None:
    print(f"\n{'='*60}\n{msg}", flush=True)


def title_bg(name: str) -> str:
    return name.strip().title()


# ---------------------------------------------------------------------------
# Phase 1 — Download GRAO
# ---------------------------------------------------------------------------

def download_grao() -> str:
    if GRAO_CACHE.exists():
        print(f"  {GRAO_CACHE.name} already cached", flush=True)
    else:
        print(f"  downloading {GRAO_URL} ...", end=" ", flush=True)
        t0 = time.time()
        subprocess.run(
            ["curl", "-s", "-A", "Mozilla/5.0", "-o", str(GRAO_CACHE), GRAO_URL],
            check=True,
        )
        print(f"done in {time.time()-t0:.1f}s", flush=True)
    return GRAO_CACHE.read_bytes().decode("cp1251", errors="replace")


# ---------------------------------------------------------------------------
# Phase 2 — Parse GRAO
# ---------------------------------------------------------------------------

def parse_grao(content: str) -> list[tuple]:
    """
    Returns list of (oblast_upper, municipality_upper, settlements) where
    settlements = [(type_char, name_title, population_or_None), ...]
    """
    results = []
    current_oblast = None
    current_muni = None
    settlements: list = []

    for line in content.splitlines():
        m = re.search(r"област\s+(.+?)\s+община\s+(.+?)\s*$", line, re.IGNORECASE)
        if m:
            if current_muni is not None:
                results.append((current_oblast, current_muni, settlements))
            current_oblast = m.group(1).strip().upper()
            current_muni = m.group(2).strip().upper()
            settlements = []
            continue

        if not line.startswith("|") or len(line) < 28:
            continue

        name_raw = line[1:26].strip()
        if not name_raw:
            continue
        skip_words = ("Всичко", "Населено", "Постоянен", "Настоящ", "адрес", "общо", "---")
        if any(w in name_raw for w in skip_words):
            continue

        pop_str = re.sub(r"\s+", "", line[27:38])
        try:
            population = int(pop_str)
        except ValueError:
            population = None

        dot = name_raw.find(".")
        if dot > 0:
            stype_key = name_raw[:dot].strip().upper()
            sname = title_bg(name_raw[dot + 1:])
        else:
            stype_key = None
            sname = title_bg(name_raw)

        stype = SETTLEMENT_TYPE.get(stype_key, "v")
        settlements.append((stype, sname, population))

    if current_muni is not None:
        results.append((current_oblast, current_muni, settlements))

    return results


# ---------------------------------------------------------------------------
# Phase 3 — Rebuild districts
# ---------------------------------------------------------------------------

def rebuild_districts(conn: sqlite3.Connection) -> dict[str, int]:
    """
    Drop and recreate districts table with numeric primary keys (no code column).
    Preserves existing geo polygons from GADM import matched by old code.
    Returns {GRAO_upper → district_id}.
    """
    step("Rebuilding districts")

    # Preserve existing geo by old GADM code before dropping table
    existing_geo: dict[str, str | None] = {}
    try:
        for code, geo in conn.execute("SELECT code, geo FROM districts").fetchall():
            existing_geo[code] = geo
    except sqlite3.OperationalError:
        pass  # No code column — districts already rebuilt

    # Map numeric id → geo using old GADM code convention
    id_to_geo: dict[int, str | None] = {}
    for grao_upper, numeric_id in GRAO_TO_DISTRICT_ID.items():
        gadm_code = "NA" if grao_upper == "СОФИЯ" else f"BG-{numeric_id:02d}"
        id_to_geo[numeric_id] = existing_geo.get(gadm_code)

    conn.execute("DROP TABLE IF EXISTS districts")
    conn.execute("""
        CREATE TABLE districts (
            id   INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            geo  TEXT
        )
    """)

    for grao_upper, numeric_id in sorted(GRAO_TO_DISTRICT_ID.items(), key=lambda x: x[1]):
        name = DISTRICT_NAME_FIX[grao_upper]
        geo = id_to_geo.get(numeric_id)
        conn.execute(
            "INSERT INTO districts (id, name, geo) VALUES (?,?,?)",
            (numeric_id, name, geo),
        )
        has_geo = "✓geo" if geo else "    "
        print(f"  {numeric_id:2d}  {has_geo}  {name}", flush=True)

    conn.commit()
    print(f"  {len(GRAO_TO_DISTRICT_ID)} districts rebuilt", flush=True)
    return GRAO_TO_DISTRICT_ID.copy()


# ---------------------------------------------------------------------------
# Phase 4 — Create geography tables
# ---------------------------------------------------------------------------

def create_tables(conn: sqlite3.Connection) -> None:
    step("Creating geography tables")
    # Drop dependent tables first
    conn.executescript("""
        DROP TABLE IF EXISTS local_regions;
        DROP TABLE IF EXISTS kmetstva;
        DROP TABLE IF EXISTS municipalities;

        CREATE TABLE municipalities (
            id          INTEGER PRIMARY KEY,
            oik_code    TEXT NOT NULL UNIQUE,
            name        TEXT NOT NULL,
            district_id INTEGER REFERENCES districts(id),
            geo         TEXT
        );

        CREATE TABLE local_regions (
            id              INTEGER PRIMARY KEY,
            number          INTEGER NOT NULL,
            name            TEXT NOT NULL,
            municipality_id INTEGER NOT NULL REFERENCES municipalities(id),
            geo             TEXT
        );

        CREATE TABLE kmetstva (
            id              INTEGER PRIMARY KEY,
            name            TEXT NOT NULL,
            type            TEXT NOT NULL CHECK(type IN ('c','v','q')),
            election_type   TEXT NOT NULL CHECK(election_type IN ('k','n')),
            municipality_id INTEGER REFERENCES municipalities(id),
            ekatte          TEXT,
            geo             TEXT
        );
    """)
    print("  municipalities, local_regions, kmetstva tables ready", flush=True)


# ---------------------------------------------------------------------------
# Phase 5 — Populate municipalities
# ---------------------------------------------------------------------------

def populate_municipalities(
    conn: sqlite3.Connection,
    grao_data: list[tuple],
    grao_to_district_id: dict[str, int],
) -> dict[tuple, int]:
    """
    Insert municipalities from GRAO data, matched to riks OIK codes.
    Returns {(oblast_upper, muni_upper) → municipality_id}.
    """
    step("Populating municipalities")

    # Build riks lookup: normalized_name → list of (riks_id, code_int)
    riks_rows = conn.execute(
        "SELECT id, code, name FROM riks WHERE name LIKE '____. %'"
    ).fetchall()
    riks_by_name: dict[str, list] = {}
    for riks_id, code, name in riks_rows:
        clean = re.sub(r"^\d{4}\.\s*", "", name).strip().upper()
        riks_by_name.setdefault(clean, []).append((riks_id, code))

    # Fallback: sections.rik_name coded forms (handles Аврен, Аксаково, etc.)
    sections_rik_coded: dict[str, list[tuple[int, int]]] = {}
    for rik_name, in conn.execute(
        "SELECT DISTINCT rik_name FROM sections WHERE rik_name LIKE '____. %'"
    ).fetchall():
        clean = re.sub(r"^\d{4}\.\s*", "", rik_name).strip().upper()
        code_4 = rik_name[:4]
        try:
            sections_rik_coded.setdefault(clean, []).append((int(code_4), int(rik_name[:2])))
        except ValueError:
            pass

    key_to_id: dict[tuple, int] = {}
    inserted = 0
    matched_oik = 0
    unmatched = []

    for oblast_upper, muni_upper, _ in grao_data:
        district_id = grao_to_district_id.get(oblast_upper)
        lookup_name = MUNICIPALITY_NAME_ALIAS.get(muni_upper, muni_upper)
        candidates = riks_by_name.get(lookup_name, [])
        oik_code: str | None = None
        resolved = False

        def accept(c4: str) -> None:
            nonlocal oik_code, resolved, matched_oik
            oik_code = c4
            resolved = True
            matched_oik += 1

        def district_matches(c4: str) -> bool:
            # OIK prefix (first 2 digits) equals district_id directly (1-28)
            return district_id is None or district_id == int(c4[:2])

        if len(candidates) == 1:
            c4 = str(candidates[0][1]).zfill(4)
            if district_matches(c4):
                accept(c4)
        elif len(candidates) > 1:
            for _rid, code_int in candidates:
                c4 = str(code_int).zfill(4)
                if district_matches(c4):
                    accept(c4)
                    break

        if not resolved:
            for code_int, _rik_num in sections_rik_coded.get(lookup_name, []):
                c4 = str(code_int).zfill(4)
                if district_matches(c4):
                    accept(c4)
                    break
            if not resolved:
                unmatched.append((oblast_upper, muni_upper))

        name = title_bg(muni_upper)
        code = oik_code or f"?{muni_upper}"

        conn.execute(
            "INSERT OR IGNORE INTO municipalities (oik_code, name, district_id) VALUES (?,?,?)",
            (code, name, district_id),
        )
        row = conn.execute(
            "SELECT id FROM municipalities WHERE oik_code=?", (code,)
        ).fetchone()
        muni_id = row[0]

        key_to_id[(oblast_upper, muni_upper)] = muni_id
        inserted += 1

    conn.commit()
    print(f"  {inserted} municipalities inserted", flush=True)
    print(f"  {matched_oik} matched to OIK codes", flush=True)
    if unmatched:
        print(f"  {len(unmatched)} without OIK match:", flush=True)
        for o, m in unmatched[:20]:
            print(f"    {o} / {m}", flush=True)

    return key_to_id


# ---------------------------------------------------------------------------
# Phase 6 — Populate kmetstva
# ---------------------------------------------------------------------------

def populate_kmetstva(
    conn: sqlite3.Connection,
    grao_data: list[tuple],
    muni_key_to_id: dict[tuple, int],
) -> None:
    step("Populating kmetstva")

    inserted = 0
    kmet_count = 0
    namestnik_count = 0

    for oblast_upper, muni_upper, settlements in grao_data:
        muni_id = muni_key_to_id.get((oblast_upper, muni_upper))

        for stype, sname, population in settlements:
            etype = (
                "n"
                if (population is not None and population < NAMESTNIK_THRESHOLD)
                else "k"
            )
            conn.execute(
                "INSERT INTO kmetstva (name, type, election_type, municipality_id) VALUES (?,?,?,?)",
                (sname, stype, etype, muni_id),
            )
            inserted += 1
            if etype == "k":
                kmet_count += 1
            else:
                namestnik_count += 1

    conn.commit()
    print(f"  {inserted} settlements inserted", flush=True)
    print(f"  {kmet_count} кмет (k) / {namestnik_count} наместник (n)  threshold={NAMESTNIK_THRESHOLD}", flush=True)


# ---------------------------------------------------------------------------
# Phase 7 — Populate local_regions
# ---------------------------------------------------------------------------

def populate_local_regions(conn: sqlite3.Connection) -> None:
    step("Populating local_regions")

    rows = conn.execute("""
        SELECT DISTINCT s.rik_name, SUBSTR(s.section_code, 1, 4) AS oik_prefix
        FROM sections s
        JOIN elections e ON e.id = s.election_id
        WHERE e.type = 'local_mayor_neighbourhood'
          AND s.rik_name IS NOT NULL
        ORDER BY oik_prefix, s.rik_name
    """).fetchall()

    inserted = 0
    for rik_name, oik_prefix in rows:
        m = re.match(r"^(\d+)\.\s*(.+)$", rik_name.strip())
        if not m:
            print(f"  WARNING: unexpected rik_name format: {rik_name!r}", flush=True)
            continue
        number = int(m.group(1))
        name = title_bg(m.group(2))

        muni = conn.execute(
            "SELECT id FROM municipalities WHERE oik_code=?", (oik_prefix,)
        ).fetchone()
        if muni is None:
            print(f"  WARNING: no municipality for oik_code {oik_prefix!r} ({rik_name})", flush=True)
            continue

        conn.execute(
            "INSERT OR IGNORE INTO local_regions (number, name, municipality_id) VALUES (?,?,?)",
            (number, name, muni[0]),
        )
        inserted += 1

    conn.commit()
    print(f"  {inserted} local regions inserted", flush=True)


# ---------------------------------------------------------------------------
# Phase 8 — Cleanup riks
# ---------------------------------------------------------------------------

def cleanup_riks(conn: sqlite3.Connection) -> None:
    """
    Reduce riks to the 32 МИР rows only.
    Rename code→oik_prefix (zero-padded "01"-"32").
    Strip number prefix from names, apply title case.
    Drop type and district_id columns.
    """
    step("Cleaning up riks table")

    before = conn.execute("SELECT COUNT(*) FROM riks").fetchone()[0]
    conn.execute("DELETE FROM riks WHERE type != 'mir'")
    after = conn.execute("SELECT COUNT(*) FROM riks").fetchone()[0]
    print(f"  {before} → {after} rows (kept МИР only)", flush=True)

    # Zero-pad codes and clean names
    for row_id, code, name in conn.execute("SELECT id, code, name FROM riks").fetchall():
        padded = str(int(code)).zfill(2)
        clean_name = re.sub(r"^\d+\.\s*", "", name).strip().title()
        conn.execute(
            "UPDATE riks SET code=?, name=? WHERE id=?",
            (padded, clean_name, row_id),
        )

    # UNIQUE(code, type) constraint blocks DROP COLUMN — rebuild the table
    conn.executescript("""
        CREATE TABLE riks_new (
            id         INTEGER PRIMARY KEY,
            oik_prefix TEXT NOT NULL UNIQUE,
            name       TEXT NOT NULL,
            geo        TEXT
        );
        INSERT INTO riks_new (id, oik_prefix, name, geo)
            SELECT id, code, name, geo FROM riks;
        DROP TABLE riks;
        ALTER TABLE riks_new RENAME TO riks;
    """)
    conn.commit()

    print("  renamed code→oik_prefix, dropped type and district_id", flush=True)
    for row in conn.execute("SELECT oik_prefix, name FROM riks ORDER BY oik_prefix").fetchall():
        print(f"    {row[0]}  {row[1]}", flush=True)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    t0 = time.time()
    conn = sqlite3.connect(DB_PATH, timeout=600)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=600000")

    step("Downloading GRAO data")
    content = download_grao()

    step("Parsing GRAO data")
    grao_data = parse_grao(content)
    muni_count = len(grao_data)
    settlement_count = sum(len(s) for _, _, s in grao_data)
    print(f"  {muni_count} municipalities, {settlement_count} settlements parsed", flush=True)

    grao_to_district_id = rebuild_districts(conn)
    create_tables(conn)
    muni_key_to_id = populate_municipalities(conn, grao_data, grao_to_district_id)
    populate_kmetstva(conn, grao_data, muni_key_to_id)
    populate_local_regions(conn)
    cleanup_riks(conn)

    conn.close()
    print(f"\nDone in {time.time()-t0:.1f}s", flush=True)


if __name__ == "__main__":
    main()
