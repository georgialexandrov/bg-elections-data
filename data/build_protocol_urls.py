#!/usr/bin/env python3
"""
build_protocol_urls.py

Populates sections.protocol_url for all elections based on CIK URL patterns.
Each election has a specific CIK results URL prefix and suffix rules.

The suffix rules (from scrape_cik_addresses.py _proto_suffix):
  pi2021 (Apr 2021): no suffix — URLs are just {code}.html
  pi2021_07, pvrns2021*, ns2022: always .0
  ns2023, mi2023*: always .1
  europe2024+, pe202410+: .0 if machine_count > 0, else .1

The data_el value (CIK internal election ID) varies per election.
For elections where we don't know data_el, we use 64 as default.

Safe to re-run: overwrites existing protocol_url values.

Usage:
    python3 data/build_protocol_urls.py
    python3 data/build_protocol_urls.py --dry-run
"""

import argparse
import os
import sqlite3
from pathlib import Path

DB_PATH = Path(os.environ.get("ELECTIONS_DB", Path(__file__).parent.parent / "elections.db"))

# DB slug → (CIK URL prefix, suffix_rule, data_el, proto_type)
# suffix_rule: "none" = {code}.html, "0" = {code}.0.html, "1" = {code}.1.html, "auto" = .0 if machine else .1
# data_el: CIK internal election type ID (from HAS_PROTO in CIK main.js)
#   64 = national parliament/president, 2 = constitutional court
#   mi2023: 1=council, 2=mayor, 4=kmetstvo, 8=neighbourhood
# proto_type: "p" for protocol, "pk" for constitutional court protocol
ELECTION_CONFIG: dict[str, tuple[str, str, int, str]] = {
    "pe202410":                 ("pe202410",            "auto", 64, "p"),
    "pe202410_ks":              ("pe202410_ks",         "auto", 64, "pk"),
    "europe2024_ns":            ("europe2024/ns",       "auto", 64, "p"),
    "europe2024_ep":            ("europe2024/ep",       "auto", 64, "p"),
    "mi2023_council":           ("mi2023/os",           "1",    1,  "p"),
    "mi2023_mayor_r1":          ("mi2023/kmet",         "1",    2,  "p"),
    "mi2023_kmetstvo_r1":       ("mi2023/ko",           "1",    4,  "p"),
    "mi2023_neighbourhood_r1":  ("mi2023/kr",           "1",    8,  "p"),
    "mi2023_mayor_r2":          ("mi2023_tur2/kmet",    "1",    2,  "p"),
    "mi2023_kmetstvo_r2":       ("mi2023_tur2/ko",      "1",    4,  "p"),
    "mi2023_neighbourhood_r2":  ("mi2023_tur2/kr",      "1",    8,  "p"),
    "ns2023":                   ("ns2023",              "1",    64, "p"),
    "ns2022":                   ("ns2022",              "0",    64, "p"),
    "pvrns2021_ns":             ("pvrns2021/tur1",      "0",    64, "p"),
    "pvrns2021_pvr_r1":         ("pvrns2021/tur1",      "0",    2,  "p"),
    "pvrns2021_pvr_r2":         ("pvrns2021/tur2",      "0",    2,  "p"),
    "pi2021_jul":               ("pi2021_07",           "0",    64, "p"),
    "pi2021_apr":               ("pi2021",              "none", 64, "p"),
}

BASE_URL = "https://results.cik.bg"


def get_suffix(rule: str, machine_count: int) -> str:
    if rule == "none":
        return ""
    if rule == "0":
        return ".0"
    if rule == "1":
        return ".1"
    # auto: .0 if machine, .1 if no machine
    return ".0" if machine_count and machine_count > 0 else ".1"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    conn = sqlite3.connect(DB_PATH)

    # Ensure column exists
    try:
        conn.execute("ALTER TABLE sections ADD COLUMN protocol_url TEXT")
    except Exception:
        pass

    elections = conn.execute("SELECT id, slug, name FROM elections ORDER BY id").fetchall()

    total_updated = 0

    for eid, slug, name in elections:
        config = ELECTION_CONFIG.get(slug)
        if not config:
            print(f"  SKIP {eid:3d} {slug:30s} — no CIK config")
            continue

        cik_prefix, suffix_rule, data_el, proto_type = config

        sections = conn.execute("""
            SELECT id, section_code, machine_count
            FROM sections
            WHERE election_id = ?
        """, (eid,)).fetchall()

        updated = 0
        for sid, code, machine_count in sections:
            rik = code[:2]
            suffix = get_suffix(suffix_rule, machine_count or 0)
            url = f"{BASE_URL}/{cik_prefix}/rezultati/{rik}.html#/{proto_type}/{data_el}/{code}{suffix}.html"

            if not args.dry_run:
                conn.execute("UPDATE sections SET protocol_url = ? WHERE id = ?", (url, sid))
            updated += 1

        total_updated += updated
        sample = sections[0] if sections else None
        if sample:
            rik = sample[1][:2]
            suffix = get_suffix(suffix_rule, sample[2] or 0)
            sample_url = f"{BASE_URL}/{cik_prefix}/rezultati/{rik}.html#/{proto_type}/{data_el}/{sample[1]}{suffix}.html"
            print(f"  {eid:3d} {slug:30s} {updated:6,} sections  {sample_url}")
        else:
            print(f"  {eid:3d} {slug:30s} {updated:6,} sections")

    if not args.dry_run:
        conn.commit()

    conn.close()
    print(f"\nTotal: {total_updated:,} sections updated")


if __name__ == "__main__":
    main()
