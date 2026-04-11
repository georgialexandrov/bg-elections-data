#!/usr/bin/env bash
# Full import pipeline for the Bulgarian elections dataset.
#
# Produces elections.db at the repo root from raw CIK data files.
# This is a one-time data preparation step — historic data doesn't change.
#
# Prerequisites:
#   - Python 3.10+
#   - SQLite CLI (sqlite3) 3.44+
#   - All raw data zips present in cik-exports/ (see cik-exports/extract.sh)
#   - cik-exports/pi2021/ must be pre-extracted (no zip source)
#
# Usage:
#   cd data && ./import.sh

set -e
cd "$(dirname "$0")"

REPO_ROOT="$(cd .. && pwd)"
PYTHON=${PYTHON:-python3}
START=$(date +%s)

# ---------------------------------------------------------------------------
# Step 0: Extract raw data zips
# ---------------------------------------------------------------------------
echo "=== Step 0: Extract CIK data archives ==="
cd cik-exports && ./extract.sh && cd ..

if [ ! -d "cik-exports/pi2021" ]; then
    echo "  ERROR: cik-exports/pi2021/ not found — must be provided manually (no zip source)"
    exit 1
fi

echo ""
echo "=== Step 1: Parse raw data + geography reference tables → elections.db ==="
$PYTHON build.py

echo ""
echo "=== Step 2: Normalize candidates (persons, riks, FK columns) ==="
$PYTHON normalize_candidates_schema.py

echo ""
echo "=== Step 3: Normalize parties → deduplicated parties + election_parties ==="
echo "  (includes president-ballot finalize + orphan-ballot synthesis)"
$PYTHON normalize_parties.py

echo ""
echo "=== Step 4: Normalize sections → deduplicated locations table ==="
$PYTHON normalize_sections.py

echo ""
echo "=== Step 5: GPS locations (optional — needs voting_locations.sql) ==="
if [ -f "voting_locations.sql" ]; then
    $PYTHON import_locations.py voting_locations.sql
else
    echo "  Skipped: voting_locations.sql not found — coordinates come from location_cache.json (Step 4)"
fi

echo ""
echo "=== Step 6: Link locations to geography (municipality, district, rik, kmetstvo) ==="
$PYTHON link_geography.py

echo ""
echo "=== Step 7: Populate sections.protocol_url (CIK results links) ==="
$PYTHON build_protocol_urls.py

echo ""
echo "=== Step 8: Section anomaly scores + protocol violations ==="
$PYTHON score_sections.py

echo ""
echo "=== Step 9: Optimize schema (WITHOUT ROWID, VACUUM, indexes) ==="
$PYTHON migrate_schema.py

echo ""
echo "=== Step 10: Validate against CIK reference ==="
$PYTHON validate_cik.py

echo ""
END=$(date +%s)
echo "Done in $((END - START))s."
echo "Output: $REPO_ROOT/elections.db"
