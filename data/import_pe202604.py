#!/usr/bin/env python3
"""
import_pe202604.py

Incremental import of the April 2026 parliamentary election into an already-
normalized `elections.db`. Full `import.sh` would rebuild the 1.4 GB DB from
scratch (~20 min); this appends pe202604 in under a minute.

Steps (idempotent — re-running replaces any existing pe202604 rows):
  1. Delete any prior pe202604 rows across every pe202604-scoped table.
  2. Parse the CIK zip via parsers.pe202604 into a temp SQLite DB.
  3. Insert the new election row; remember its id.
  4. Match each ballot number to a canonical `parties` row. New parties are
     created. Existing canonical rows are preferred via a normalised match
     against canonical_name / short_name / election_parties.name_on_ballot
     so pe202410's GERB-СДС and pe202604's GERB-СДС don't become two rows.
  5. For each section, find or create a `locations` row keyed by
     (ekatte, normalised_address). Fill `locations.lat/lng` from the inline
     CIK coordinates in sections.txt — CIK-official, no Google API call.
  6. Insert sections (with per-election settlement/rik_code/machine_count)
     and protocols, votes, preferences, candidates.
  7. Populate sections.protocol_url using the pe202410 template.
  8. Add sections.video_url if missing, populate from the live-stream scraper
     JSON (streams_pe202604_tour1_live.json).
  9. Run link_geography-style FK backfill just for pe202604 locations.

Usage:
  python3 data/import_pe202604.py
  python3 data/import_pe202604.py --db ./elections.db --temp /tmp/pe202604.db
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sqlite3
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parent

sys.path.insert(0, str(HERE))
from parsers import pe202604 as pe202604_parser  # noqa: E402
from normalize_sections import normalize_address  # noqa: E402

DEFAULT_DB = REPO_ROOT / "elections.db"
STREAMS_JSON = Path(
    "/Users/georgialexandrov/Developer/elections-hackaton/elections/"
    "elections-video-monitoring/apps/scraper/streams_pe202604_tour1_live.json"
)
SLUG = "pe202604"
ELECTION_NAME = "Народно събрание 19.04.2026"
ELECTION_TYPE = "parliament"
ELECTION_DATE = "2026-04-19"
ELECTION_ROUND = 1

# pe202410-style CIK URL
CIK_URL_TEMPLATE = (
    "https://results.cik.bg/pe202604/rezultati/{area}.html"
    "#/p/64/{section}{suffix}.html"
)


# ---------------------------------------------------------------------------
# Party name normalisation (for matching pe202604 → existing canonical rows)
# ---------------------------------------------------------------------------

_PARTY_STRIP_PREFIX = re.compile(
    r"^(ПП|КП|КОАЛИЦИЯ|ПАРТИЯ|НД)\s+", re.IGNORECASE
)
_PARTY_PUNCT = re.compile(r"[\s\"'„“”„\-–—]+")


def norm_party(name: str) -> str:
    if not name:
        return ""
    s = name.strip()
    # Strip common legal-form prefixes that tend to drift ("ПП ГЛАС НАРОДЕН" vs "ГЛАС НАРОДЕН")
    while True:
        prev = s
        s = _PARTY_STRIP_PREFIX.sub("", s).strip()
        if s == prev:
            break
    # Remove whitespace / quotes / dashes entirely → compact key
    s = _PARTY_PUNCT.sub("", s)
    return s.upper()


def build_party_index(conn: sqlite3.Connection) -> dict[str, int]:
    """normalised_name → party_id, combining parties + election_parties.name_on_ballot."""
    idx: dict[str, int] = {}
    for pid, canon, short in conn.execute(
        "SELECT id, canonical_name, short_name FROM parties"
    ):
        for name in (canon, short):
            key = norm_party(name or "")
            if key and key not in idx:
                idx[key] = pid
    for pid, name in conn.execute(
        "SELECT party_id, name_on_ballot FROM election_parties"
    ):
        key = norm_party(name or "")
        if key and key not in idx:
            idx[key] = pid
    return idx


# ---------------------------------------------------------------------------
# Delete any prior pe202604 rows so the script is re-runnable
# ---------------------------------------------------------------------------

def delete_existing(conn: sqlite3.Connection) -> int | None:
    row = conn.execute("SELECT id FROM elections WHERE slug = ?", (SLUG,)).fetchone()
    if not row:
        return None
    eid = row[0]
    for table in [
        "votes", "preferences", "protocols", "candidates",
        "election_parties", "sections",
        "section_scores", "protocol_violations",
    ]:
        try:
            conn.execute(f"DELETE FROM {table} WHERE election_id = ?", (eid,))
        except sqlite3.OperationalError:
            pass
    conn.execute("DELETE FROM elections WHERE id = ?", (eid,))
    # Clean up locations we created for pe202604 that are now orphans.
    # Only touch rows tagged 'cik-official' (our integrator's marker) to
    # avoid deleting Google-geocoded locations reused by older elections.
    conn.execute(
        "DELETE FROM locations "
        "WHERE geocode_source = 'cik-official' "
        "  AND id NOT IN (SELECT DISTINCT location_id FROM sections WHERE location_id IS NOT NULL)"
    )
    return eid


# ---------------------------------------------------------------------------
# Core integrator
# ---------------------------------------------------------------------------

def ensure_columns(conn: sqlite3.Connection) -> None:
    cols = {row[1] for row in conn.execute("PRAGMA table_info(sections)")}
    for col, typedef in [
        ("video_url", "TEXT"),
        ("lat", "REAL"),
        ("lng", "REAL"),
        ("address", "TEXT"),
        ("settlement_name", "TEXT"),
        ("protocol_url", "TEXT"),
        ("protocol_address", "TEXT"),
    ]:
        if col not in cols:
            conn.execute(f"ALTER TABLE sections ADD COLUMN {col} {typedef}")


def insert_election(conn: sqlite3.Connection) -> int:
    conn.execute(
        "INSERT INTO elections (slug, name, type, date, round) VALUES (?,?,?,?,?)",
        (SLUG, ELECTION_NAME, ELECTION_TYPE, ELECTION_DATE, ELECTION_ROUND),
    )
    return conn.execute("SELECT id FROM elections WHERE slug = ?", (SLUG,)).fetchone()[0]


def copy_parties(conn: sqlite3.Connection, temp: sqlite3.Connection, eid: int) -> int:
    """Map CIK ballot numbers → existing or new `parties.id`, write election_parties."""
    party_index = build_party_index(conn)
    rows = temp.execute(
        "SELECT number, name FROM parties WHERE election_id = 1 ORDER BY number"
    ).fetchall()

    matched = 0
    created = 0
    for number, name in rows:
        key = norm_party(name)
        pid = party_index.get(key) if key else None
        if pid is None:
            cur = conn.execute(
                "INSERT INTO parties (canonical_name, short_name) VALUES (?, ?)",
                (name, name),
            )
            pid = cur.lastrowid
            if key:
                party_index[key] = pid
            created += 1
        else:
            matched += 1
        conn.execute(
            "INSERT INTO election_parties (election_id, ballot_number, party_id, name_on_ballot) "
            "VALUES (?, ?, ?, ?)",
            (eid, number, pid, name),
        )
    return {"matched": matched, "created": created, "total": len(rows)}


def _norm_ekatte(ekatte: str | None) -> str:
    """pe202604 ships 5-digit ekatte codes with leading zeros ("00702"); older
    exports store them stripped ("702"). Strip zeros for dedup keys."""
    if not ekatte:
        return ""
    return str(ekatte).lstrip("0")


def copy_sections_and_locations(conn: sqlite3.Connection, temp: sqlite3.Connection, eid: int) -> dict:
    """Insert sections + deduplicate locations. CIK lat/lng overrides existing values."""
    # Pre-load existing locations for dedup. Key is (normalised_ekatte, normalised_address)
    # so "00702" and "702" collide, as do "ГР. АСЕНОВГРАД..." and "ГР.АСЕНОВГРАД...".
    loc_index: dict[tuple[str, str], int] = {}
    for lid, ekatte, address in conn.execute(
        "SELECT id, COALESCE(ekatte,''), COALESCE(address,'') FROM locations"
    ):
        ek_key = _norm_ekatte(ekatte)
        addr_key = normalize_address(address) if address else ""
        if addr_key or ek_key:
            key = (ek_key, addr_key)
            loc_index.setdefault(key, lid)

    rows = temp.execute(
        "SELECT section_code, rik_code, rik_name, ekatte, settlement_name, address, "
        "       is_mobile, is_ship, machine_count, lat, lng "
        "FROM sections WHERE election_id = 1"
    ).fetchall()

    new_locations = 0
    reused_locations = 0
    coord_updates = 0
    section_inserts: list[tuple] = []

    for (section_code, rik_code, rik_name, ekatte, settlement,
         address, is_mobile, is_ship, machines, lat, lng) in rows:
        ekatte = ekatte or ""
        ek_key = _norm_ekatte(ekatte)
        addr_key = normalize_address(address) if address else ""
        key = (ek_key, addr_key) if (ek_key or addr_key) else ("", section_code)
        lid = loc_index.get(key)

        if lid is None:
            cur = conn.execute(
                "INSERT INTO locations (ekatte, settlement_name, address, lat, lng, geocode_source) "
                "VALUES (?,?,?,?,?,?)",
                (ekatte or None, settlement, address, lat, lng, "cik-official"),
            )
            lid = cur.lastrowid
            loc_index[key] = lid
            new_locations += 1
        else:
            reused_locations += 1
            if lat is not None and lng is not None:
                # CIK-official coordinates take precedence over any prior geocoder value.
                conn.execute(
                    "UPDATE locations SET lat = ?, lng = ?, geocode_source = 'cik-official' "
                    "WHERE id = ?",
                    (lat, lng, lid),
                )
                coord_updates += 1

        section_inserts.append((
            eid, section_code, lid, rik_code, rik_name, settlement,
            address, lat, lng, is_mobile, is_ship, machines,
        ))

    conn.executemany(
        "INSERT INTO sections (election_id, section_code, location_id, rik_code, rik_name, "
        "settlement_name, address, lat, lng, is_mobile, is_ship, machine_count) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        section_inserts,
    )

    return {
        "sections": len(section_inserts),
        "new_locations": new_locations,
        "reused_locations": reused_locations,
        "coord_updates": coord_updates,
    }


def copy_protocols_votes_preferences(conn: sqlite3.Connection, temp: sqlite3.Connection, eid: int) -> dict:
    # protocols
    proto_rows = temp.execute(
        "SELECT section_code, form_num, received_ballots, registered_voters, added_voters, "
        "       actual_voters, invalid_votes, null_votes "
        "FROM protocols WHERE election_id = 1"
    ).fetchall()
    conn.executemany(
        "INSERT INTO protocols (election_id, section_code, form_num, received_ballots, "
        "registered_voters, added_voters, actual_voters, invalid_votes, null_votes) "
        "VALUES (?,?,?,?,?,?,?,?,?)",
        [(eid, *r) for r in proto_rows],
    )

    # votes (WITHOUT ROWID — section_code + party_number compound PK on target)
    votes_rows = temp.execute(
        "SELECT section_code, party_number, total, paper, machine "
        "FROM votes WHERE election_id = 1"
    ).fetchall()
    conn.executemany(
        "INSERT INTO votes (election_id, section_code, party_number, total, paper, machine) "
        "VALUES (?,?,?,?,?,?)",
        [(eid, *r) for r in votes_rows],
    )

    # preferences
    pref_rows = temp.execute(
        "SELECT section_code, party_number, candidate_number, total, paper, machine "
        "FROM preferences WHERE election_id = 1"
    ).fetchall()
    conn.executemany(
        "INSERT INTO preferences (election_id, section_code, party_number, candidate_number, "
        "total, paper, machine) VALUES (?,?,?,?,?,?,?)",
        [(eid, *r) for r in pref_rows],
    )

    return {
        "protocols": len(proto_rows),
        "votes": len(votes_rows),
        "preferences": len(pref_rows),
    }


def copy_candidates(conn: sqlite3.Connection, temp: sqlite3.Connection, eid: int) -> int:
    rows = temp.execute(
        "SELECT rik_code, party_number, list_position, name "
        "FROM candidates WHERE election_id = 1"
    ).fetchall()

    # Resolve person_id via persons table
    person_cache: dict[str, int] = {}
    for row in conn.execute("SELECT id, name FROM persons"):
        person_cache[row[1]] = row[0]

    inserts = []
    for rik_code, party_num, list_pos, name in rows:
        pid = person_cache.get(name)
        if pid is None and name:
            cur = conn.execute("INSERT INTO persons (name) VALUES (?)", (name,))
            pid = cur.lastrowid
            person_cache[name] = pid
        inserts.append((eid, rik_code, party_num, list_pos, name, pid))

    conn.executemany(
        "INSERT INTO candidates (election_id, rik_code, party_number, list_position, name, person_id) "
        "VALUES (?,?,?,?,?,?)",
        inserts,
    )
    return len(inserts)


def populate_protocol_urls(conn: sqlite3.Connection, eid: int) -> int:
    rows = conn.execute(
        "SELECT id, section_code, machine_count FROM sections WHERE election_id = ?",
        (eid,),
    ).fetchall()
    updates = []
    for sid, code, mc in rows:
        area = code[:2]
        suffix = ".0" if (mc and mc > 0) else ".1"
        url = CIK_URL_TEMPLATE.format(area=area, section=code, suffix=suffix)
        updates.append((url, sid))
    conn.executemany("UPDATE sections SET protocol_url = ? WHERE id = ?", updates)
    return len(updates)


def populate_video_urls(conn: sqlite3.Connection, eid: int) -> int:
    if not STREAMS_JSON.exists():
        print(f"  WARN: stream JSON not found at {STREAMS_JSON} — skipping video_url")
        return 0
    with STREAMS_JSON.open() as f:
        streams = json.load(f)
    by_section = {entry["section"]: entry["url"] for entry in streams if entry.get("section")}

    matched = 0
    for section_code, url in by_section.items():
        cur = conn.execute(
            "UPDATE sections SET video_url = ? WHERE election_id = ? AND section_code = ?",
            (url, eid, section_code),
        )
        if cur.rowcount:
            matched += 1
    return matched


def backfill_geography_fks(conn: sqlite3.Connection, eid: int) -> dict:
    """
    Fill `locations.municipality_id / district_id / rik_id / kmetstvo_id` for
    pe202604 locations.

    The CIK 2026 RIK-to-municipality numbering doesn't match the historical
    `municipalities.oik_code` column — a section-code prefix like 1717 is
    Марица (Plovdiv) in CIK but Лозница (Razgrad) in the oik_code table.
    So the direct `mun_by_oik` lookup is WRONG for many rural Plovdiv /
    Sofia-okrug muns.

    Priority order:
      1. Ekatte-based majority — across *all* elections, which municipality
         do locations at this ekatte most commonly belong to? This is the
         strongest signal: villages don't relocate between RIKs.
      2. Section-code prefix mapping from the most recent prior parliament.
         Covers new polling places in cities where ekatte doesn't help.
      3. `mun_by_oik` direct lookup (the pre-existing link_geography.py
         logic). Last-ditch fallback for sections with no historical match.
    """
    locs = conn.execute(
        "SELECT DISTINCT l.id, l.ekatte, l.settlement_name "
        "FROM locations l JOIN sections s ON s.location_id = l.id "
        "WHERE s.election_id = ?",
        (eid,),
    ).fetchall()

    loc_prefix = {
        row[0]: row[1]
        for row in conn.execute(
            "SELECT location_id, substr(section_code, 1, 4) AS mun_prefix "
            "FROM sections WHERE election_id = ? AND location_id IS NOT NULL "
            "GROUP BY location_id ORDER BY COUNT(*) DESC",
            (eid,),
        )
    }
    loc_rik_prefix = {
        row[0]: row[1]
        for row in conn.execute(
            "SELECT location_id, substr(section_code, 1, 2) AS rik_prefix "
            "FROM sections WHERE election_id = ? AND location_id IS NOT NULL "
            "GROUP BY location_id ORDER BY COUNT(*) DESC",
            (eid,),
        )
    }

    mun_by_oik = {
        row[0]: (row[1], row[2])
        for row in conn.execute(
            "SELECT oik_code, id, district_id FROM municipalities"
        )
    }
    rik_by_prefix = {
        row[0]: row[1]
        for row in conn.execute("SELECT oik_prefix, id FROM riks")
    }
    kmetstvo_by_ekatte = {
        row[0]: row[1]
        for row in conn.execute("SELECT ekatte, id FROM kmetstva WHERE ekatte IS NOT NULL")
    }

    # Ekatte → (municipality_id, district_id) via majority vote across all
    # elections. Handles Царацово (ekatte 78080) correctly as Марица even
    # though some stale rows point it at Лозница.
    ekatte_mun_map: dict[str, tuple[int, int]] = {}
    from collections import Counter
    ekatte_counters: dict[str, Counter] = {}
    for ek, mun, dist in conn.execute(
        "SELECT l.ekatte, l.municipality_id, l.district_id "
        "  FROM locations l JOIN sections s ON s.location_id = l.id "
        " WHERE l.ekatte IS NOT NULL AND l.ekatte != '' "
        "   AND l.municipality_id IS NOT NULL AND s.election_id <> ?",
        (eid,),
    ):
        ekatte_counters.setdefault(ek, Counter())[(mun, dist)] += 1
    for ek, counter in ekatte_counters.items():
        ekatte_mun_map[ek] = counter.most_common(1)[0][0]

    # Section-prefix → (municipality_id, district_id) via majority vote
    # across prior parliamentary elections. Used when ekatte lookup fails.
    prefix_counters: dict[str, Counter] = {}
    for pfx, mun, dist in conn.execute(
        """
        SELECT substr(s.section_code,1,4) AS mun_prefix,
               l.municipality_id, l.district_id
          FROM sections s JOIN locations l ON l.id = s.location_id
          JOIN elections e ON e.id = s.election_id
         WHERE l.municipality_id IS NOT NULL
           AND e.type = 'parliament' AND e.id < ?
        """,
        (eid,),
    ):
        prefix_counters.setdefault(pfx, Counter())[(mun, dist)] += 1
    prefix_mun_map = {
        pfx: counter.most_common(1)[0][0] for pfx, counter in prefix_counters.items()
    }

    stats = {"municipality": 0, "district": 0, "rik": 0, "kmetstvo": 0}
    for lid, ekatte, _settle in locs:
        mun_prefix = loc_prefix.get(lid)
        rik_prefix = loc_rik_prefix.get(lid)

        mun_id = dist_id = rik_id = kmet_id = None
        if ekatte and ekatte in ekatte_mun_map:
            mun_id, dist_id = ekatte_mun_map[ekatte]
        elif mun_prefix and mun_prefix in prefix_mun_map:
            mun_id, dist_id = prefix_mun_map[mun_prefix]
        elif mun_prefix and mun_prefix in mun_by_oik:
            mun_id, dist_id = mun_by_oik[mun_prefix]

        if rik_prefix and rik_prefix in rik_by_prefix:
            rik_id = rik_by_prefix[rik_prefix]
        if ekatte and ekatte in kmetstvo_by_ekatte:
            kmet_id = kmetstvo_by_ekatte[ekatte]

        # For pe202604 we always want the latest classification. Overwrite
        # (not COALESCE) on location rows that are only tied to pe202604 —
        # but keep COALESCE for reused historical locations to avoid
        # rewriting other elections' correct mun_id.
        only_pe202604 = conn.execute(
            "SELECT 1 FROM sections WHERE location_id = ? AND election_id <> ? LIMIT 1",
            (lid, eid),
        ).fetchone() is None

        if only_pe202604:
            conn.execute(
                "UPDATE locations SET municipality_id = ?, district_id = ?, "
                "  rik_id = COALESCE(?, rik_id), kmetstvo_id = COALESCE(?, kmetstvo_id) "
                "WHERE id = ?",
                (mun_id, dist_id, rik_id, kmet_id, lid),
            )
        else:
            conn.execute(
                "UPDATE locations SET "
                "  municipality_id = COALESCE(?, municipality_id), "
                "  district_id     = COALESCE(?, district_id), "
                "  rik_id          = COALESCE(?, rik_id), "
                "  kmetstvo_id     = COALESCE(?, kmetstvo_id) "
                "WHERE id = ?",
                (mun_id, dist_id, rik_id, kmet_id, lid),
            )

        for key, val in zip(("municipality", "district", "rik", "kmetstvo"),
                            (mun_id, dist_id, rik_id, kmet_id)):
            if val is not None:
                stats[key] += 1
    return stats


# ---------------------------------------------------------------------------
# Driver
# ---------------------------------------------------------------------------

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", type=Path, default=DEFAULT_DB)
    ap.add_argument("--temp", type=Path, default=None, help="Temp parser DB path")
    ap.add_argument("--keep-temp", action="store_true")
    args = ap.parse_args()

    db_path = args.db
    temp_path = args.temp or Path("/tmp/pe202604_parse.db")

    if not db_path.exists():
        print(f"Target DB not found: {db_path}", file=sys.stderr)
        return 1

    t0 = time.monotonic()
    print(f"Parsing pe202604 → {temp_path}")
    pe202604_parser.parse(str(temp_path))

    print(f"Importing into {db_path}")
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA foreign_keys = OFF")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA synchronous = NORMAL")

    temp = sqlite3.connect(f"file:{temp_path}?mode=ro", uri=True)

    try:
        old_eid = delete_existing(conn)
        if old_eid:
            print(f"  Removed prior pe202604 (was election id {old_eid})")

        ensure_columns(conn)

        eid = insert_election(conn)
        print(f"  Election id: {eid}")

        party_stats = copy_parties(conn, temp, eid)
        print(f"  Parties: {party_stats['total']} total  "
              f"(matched {party_stats['matched']}, created {party_stats['created']})")

        sec_stats = copy_sections_and_locations(conn, temp, eid)
        print(f"  Sections: {sec_stats['sections']:,}  "
              f"locations: +{sec_stats['new_locations']:,} new, "
              f"~{sec_stats['reused_locations']:,} reused, "
              f"{sec_stats['coord_updates']:,} coord updates")

        pvp = copy_protocols_votes_preferences(conn, temp, eid)
        print(f"  Protocols: {pvp['protocols']:,}  "
              f"Votes: {pvp['votes']:,}  "
              f"Preferences: {pvp['preferences']:,}")

        cand_n = copy_candidates(conn, temp, eid)
        print(f"  Candidates: {cand_n:,}")

        n_proto_urls = populate_protocol_urls(conn, eid)
        print(f"  Protocol URLs: {n_proto_urls:,}")

        n_video = populate_video_urls(conn, eid)
        print(f"  Video URLs:    {n_video:,}")

        geo_stats = backfill_geography_fks(conn, eid)
        print(f"  Geography FKs: mun={geo_stats['municipality']:,} "
              f"dist={geo_stats['district']:,} "
              f"rik={geo_stats['rik']:,} "
              f"kmet={geo_stats['kmetstvo']:,}")

        conn.commit()
    finally:
        temp.close()
        conn.close()
        if not args.keep_temp and temp_path.exists() and args.temp is None:
            try:
                temp_path.unlink()
            except OSError:
                pass

    print(f"\nDone in {time.monotonic() - t0:.1f}s. Election id = {eid}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
