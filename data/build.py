#!/usr/bin/env python3
"""
build.py — Orchestrator for parallel election parsing and merge.

Each parser module in parsers/ writes to its own temp SQLite DB.
This script runs all parsers in parallel (one process per CPU core),
then merges all temp DBs into the final elections.db.

Usage:
    python build.py                    # build all elections
    python build.py pi2021_jul         # build only matching parser(s)
    python build.py pi2021 ns2022      # build multiple parsers
    python build.py --out /path/to.db  # custom output path
"""

import os
import importlib
import sqlite3
import sys
import time
from multiprocessing import Pool
from pathlib import Path

from parsers.common import SCHEMA, PROJECT_DIR, DATA_DIR

DB_PATH = os.path.join(PROJECT_DIR, "elections.db")
GEOGRAPHY_SQL = os.path.join(DATA_DIR, "geography.sql")

# ---------------------------------------------------------------------------
# Parser module registry — one entry per parser file in parsers/
# Each module must export: parse(db_path: str | None = None) -> dict
#   dict keys: "db_path", "elections" (list of slug strings)
# ---------------------------------------------------------------------------

PARSER_MODULES = [
    # === 2024 ===
    "parsers.pe202410",
    "parsers.europe2024",
    # === 2023 ===
    "parsers.mi2023",
    "parsers.ns2023",
    # === 2022 ===
    "parsers.ns2022",
    # === 2021 ===
    "parsers.pvrns2021",
    "parsers.pi2021_jul",
    "parsers.pi2021_apr",
]


def run_parser(module_name: str) -> dict:
    """
    Import and run a parser module. Called in a worker process.

    Returns dict with "module", "db_path", "elections", "elapsed",
    or "module" and "error" on failure.
    """
    t0 = time.monotonic()
    try:
        mod = importlib.import_module(module_name)
        result = mod.parse()
        result["module"] = module_name
        result["elapsed"] = time.monotonic() - t0
        return result
    except Exception as e:
        import traceback
        return {
            "module": module_name,
            "error": f"{e}\n{traceback.format_exc()}",
            "elapsed": time.monotonic() - t0,
        }


# ---------------------------------------------------------------------------
# Merge: ATTACH each temp DB → INSERT...SELECT with ID remapping
# ---------------------------------------------------------------------------

# Tables that reference election_id (all except elections itself)
FK_TABLES = ["sections", "parties", "candidates", "protocols", "votes", "preferences"]

# Column lists for each table (excluding auto-increment id and election_id)
TABLE_COLUMNS = {
    "sections":    "section_code, rik_code, rik_name, ekatte, settlement_name, address, is_mobile, is_ship, machine_count",
    "parties":     "number, name, rik_code",
    "candidates":  "rik_code, party_number, list_position, name",
    "protocols":   "section_code, form_num, received_ballots, registered_voters, added_voters, actual_voters, invalid_votes, null_votes",
    "votes":       "section_code, party_number, total, paper, machine",
    "preferences": "section_code, party_number, candidate_number, total, paper, machine",
}


def merge_temp_dbs(results: list[dict], target_path: str):
    """
    Merge all temp parser DBs into a single target database.

    Each temp DB has its own election IDs starting from 1.
    During merge, elections get new IDs in the target DB, and all
    FK references (election_id) are remapped accordingly.
    """
    for suffix in ("", "-wal", "-shm", "-journal"):
        p = target_path + suffix
        if os.path.exists(p):
            os.remove(p)

    conn = sqlite3.connect(target_path)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA cache_size=-64000")
    conn.executescript(SCHEMA)
    conn.commit()

    cur = conn.cursor()
    total_elections = 0

    for result in results:
        if "error" in result:
            continue

        temp_path = result["db_path"]
        if not os.path.exists(temp_path):
            print(f"  WARN: {result['module']} temp DB not found: {temp_path}", file=sys.stderr)
            continue

        cur.execute(f"ATTACH DATABASE ? AS src", (temp_path,))

        # Get all elections from the temp DB
        src_elections = cur.execute(
            "SELECT id, slug, name, type, date, round FROM src.elections ORDER BY id"
        ).fetchall()

        for old_id, slug, name, etype, date, round_ in src_elections:
            # Insert election with new ID in target
            cur.execute(
                "INSERT INTO elections (slug, name, type, date, round) VALUES (?,?,?,?,?)",
                (slug, name, etype, date, round_),
            )
            new_id = cur.lastrowid

            # Copy all FK tables, remapping election_id
            for table in FK_TABLES:
                cols = TABLE_COLUMNS[table]
                cur.execute(
                    f"INSERT INTO {table} (election_id, {cols}) "
                    f"SELECT ?, {cols} FROM src.{table} WHERE election_id = ?",
                    (new_id, old_id),
                )

            total_elections += 1

        conn.commit()
        cur.execute("DETACH DATABASE src")

    conn.commit()
    conn.close()
    return total_elections


def print_summary(db_path: str):
    """Print database summary stats."""
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()

    print(f"\n{'=' * 60}")
    print(f"Database: {db_path}")

    for table, label in [
        ("elections",   "Elections"),
        ("sections",    "Sections"),
        ("parties",     "Parties"),
        ("candidates",  "Candidates"),
        ("protocols",   "Protocols"),
        ("votes",       "Vote rows"),
        ("preferences", "Pref rows"),
    ]:
        count = cur.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        print(f"  {label:<12} {count:>10,}")

    total = cur.execute("SELECT SUM(total) FROM votes").fetchone()[0]
    print(f"  {'Total votes':<12} {(total or 0):>10,}")

    conn.close()
    print(f"{'=' * 60}")


def filter_parsers(filters: list[str]) -> list[str]:
    """Filter PARSER_MODULES by substrings. E.g. 'pi2021_jul' matches 'parsers.pi2021_jul'."""
    if not filters:
        return PARSER_MODULES
    matched = [m for m in PARSER_MODULES if any(f in m for f in filters)]
    if not matched:
        print(f"No parsers match: {filters}", file=sys.stderr)
        print(f"Available: {[m.split('.')[-1] for m in PARSER_MODULES]}", file=sys.stderr)
        sys.exit(1)
    return matched


def main():
    # Parse args: --out PATH for output, everything else is a filter
    target = DB_PATH
    filters = []
    args = sys.argv[1:]
    i = 0
    while i < len(args):
        if args[i] == "--out" and i + 1 < len(args):
            target = args[i + 1]
            i += 2
        else:
            filters.append(args[i])
            i += 1

    modules = filter_parsers(filters)

    # Filtered runs use a temp DB to avoid overwriting the full production DB
    if filters and target == DB_PATH:
        target = os.path.join(os.path.dirname(DB_PATH), "elections_debug.db")

    workers = min(os.cpu_count() or 4, len(modules))

    print(f"Building elections database")
    print(f"  Target:  {target}")
    print(f"  Parsers: {len(modules)}{' (filtered)' if filters else ''}")
    print(f"  Workers: {workers}")
    print()

    # --- Phase 1: parallel parse ---
    t0 = time.monotonic()
    if len(modules) == 1:
        results = [run_parser(modules[0])]
    else:
        with Pool(processes=workers) as pool:
            results = pool.map(run_parser, modules)
    parse_time = time.monotonic() - t0

    # Report parse results
    ok = [r for r in results if "error" not in r]
    failed = [r for r in results if "error" in r]

    for r in sorted(ok, key=lambda r: r["elapsed"]):
        n = len(r.get("elections", []))
        print(f"  OK  {r['module']:<30} {n} election(s)  {r['elapsed']:.1f}s")
    for r in failed:
        print(f"  FAIL {r['module']:<30} {r['error'].splitlines()[0]}")

    print(f"\nParse phase: {len(ok)}/{len(PARSER_MODULES)} parsers OK in {parse_time:.1f}s")

    if failed:
        print(f"\n{len(failed)} parser(s) failed:", file=sys.stderr)
        for r in failed:
            print(f"  {r['module']}: {r['error']}", file=sys.stderr)

    if not ok:
        print("No parsers succeeded. Aborting.", file=sys.stderr)
        return 1

    # --- Phase 2: merge ---
    t1 = time.monotonic()
    total = merge_temp_dbs(ok, target)
    merge_time = time.monotonic() - t1

    print(f"Merge phase: {total} elections merged in {merge_time:.1f}s")

    # --- Phase 3: import geography reference tables ---
    # Imports riks, districts, municipalities, local_regions, kmetstva from geography.sql.
    # Skips the old `locations` table — normalize_sections.py creates a new one.
    # Uses sqlite3 CLI (not Python's module) — needs SQLite ≥3.44 for unistr()
    if os.path.exists(GEOGRAPHY_SQL):
        import subprocess
        t2 = time.monotonic()
        drop_sql = ("DROP TABLE IF EXISTS riks; DROP TABLE IF EXISTS districts; "
                     "DROP TABLE IF EXISTS municipalities; DROP TABLE IF EXISTS local_regions; "
                     "DROP TABLE IF EXISTS kmetstva;")
        subprocess.run(["sqlite3", target, drop_sql], check=True)
        # Filter out the old locations table from geography.sql
        with open(GEOGRAPHY_SQL) as f:
            sql = f.read()
        # Remove CREATE TABLE locations and its INSERT statements
        import re
        sql = re.sub(r'CREATE TABLE locations\s*\([^)]+\);', '', sql)
        sql = re.sub(r"INSERT INTO locations VALUES\([^)]+\);", '', sql)
        subprocess.run(["sqlite3", target], input=sql.encode(), check=True)
        print(f"Geography: imported in {time.monotonic() - t2:.1f}s")

    # --- Summary ---
    print_summary(target)

    # Clean up temp DBs
    for r in ok:
        try:
            os.remove(r["db_path"])
        except OSError:
            pass

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
