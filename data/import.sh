#!/usr/bin/env bash
# Full import pipeline for the Bulgarian elections dataset.
#
# Produces elections.db at the repo root from raw CIK data files.
# This is a one-time data preparation step — historic data doesn't change.
#
# Prerequisites:
#   - Python 3 installed
#   - All raw data zips present in cik-exports/ (see cik-exports/extract.sh)
#   - pi2021/ must be present in cik-exports/ (no zip available)
#   - voting_locations.sql (optional) — GPS coordinates for polling stations
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
$PYTHON normalize_parties.py

echo ""
echo "=== Step 4: Normalize sections → deduplicated locations table ==="
$PYTHON normalize_sections.py

echo ""
echo "=== Step 5: GPS locations ==="
if [ -f "voting_locations.sql" ]; then
    $PYTHON import_locations.py voting_locations.sql
else
    echo "  Skipped: voting_locations.sql not found — GPS coordinates will be absent"
fi

echo ""
echo "=== Step 6: Link locations to geography (municipality, district, rik, kmetstvo) ==="
$PYTHON link_geography.py

echo ""
echo "=== Step 7: GPS coordinates from voting_locations.json ==="
$PYTHON import_gps.py

echo ""
echo "=== Step 8: Optimize schema (WITHOUT ROWID tables, VACUUM) ==="
$PYTHON migrate_schema.py

echo ""
echo "=== Step 9: Validate against CIK reference ==="
$PYTHON validate_cik.py

echo ""
END=$(date +%s)
echo "Done in $((END - START))s."
echo "Output: $REPO_ROOT/elections.db"
