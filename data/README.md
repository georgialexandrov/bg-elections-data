# Data Pipeline

Builds `elections.db` from raw CIK (Central Election Commission) data exports. Covers all Bulgarian elections from April 2021 to October 2024 — 18 elections total.

The pre-built database is available from [GitHub Releases](../../releases). Use this pipeline only if you want to rebuild from source or verify the data yourself.

## Quick Start

```bash
# 1. Download CIK source data (one-time, ~385MB)
cd data
gh release download cik-exports-2021-2024 --dir cik-exports/

# 2. Run the pipeline
./import.sh
```

Produces `elections.db` at the repo root. Takes ~2 minutes.

### Prerequisites

- Python 3.10+
- SQLite CLI (`sqlite3`) version 3.44+ (for `unistr()` in geography import)
- GitHub CLI (`gh`) for downloading CIK source data
- `cik-exports/pi2021/` directory must exist (no zip available — downloaded as individual files from CIK)

## What the Pipeline Does

| Step | Script | What |
|------|--------|------|
| 0 | `cik-exports/extract.sh` | Extracts CIK zip archives into working directories |
| 1 | `build.py` | Runs all parsers in parallel, merges into elections.db, imports geography |
| 2 | `normalize_candidates_schema.py` | Deduplicates candidates, creates persons table |
| 3 | `normalize_parties.py` | Deduplicates parties; finalizes president ballots; synthesizes orphan ballots |
| 4 | `normalize_sections.py` | Deduplicates polling sections into locations table |
| 5 | `import_locations.py` | GPS coordinates from `voting_locations.sql` (optional) |
| 6 | `link_geography.py` | Links locations to municipalities, districts, RIKs |
| 7 | `build_protocol_urls.py` | Populates `sections.protocol_url` (CIK results links) |
| 8 | `score_sections.py` | Anomaly scores (Benford, peer, ACF) + protocol violations |
| 9 | `migrate_schema.py` | WITHOUT ROWID optimization + VACUUM |
| 10 | `validate_cik.py` | Validates totals against CIK official results |

## Running Individual Steps

```bash
# Build only specific elections (writes to elections_debug.db)
python build.py pe202410
python build.py pi2021 ns2022

# Validate against CIK reference
python validate_cik.py              # all elections
python validate_cik.py pe202410     # one election

# Protocol arithmetic check
python validate.py
```

## Elections in the Database

| Slug | Type | Date |
|------|------|------|
| pi2021_apr | parliament | 2021-04-04 |
| pi2021_jul | parliament | 2021-07-11 |
| pvrns2021_ns | parliament | 2021-11-14 |
| pvrns2021_pvr_r1 | president | 2021-11-14 |
| pvrns2021_pvr_r2 | president | 2021-11-21 |
| ns2022 | parliament | 2022-10-02 |
| ns2023 | parliament | 2023-04-02 |
| mi2023_council | local_council | 2023-10-29 |
| mi2023_mayor_r1 | local_mayor | 2023-10-29 |
| mi2023_mayor_r2 | local_mayor | 2023-11-05 |
| mi2023_kmetstvo_r1 | local_mayor_kmetstvo | 2023-10-29 |
| mi2023_kmetstvo_r2 | local_mayor_kmetstvo | 2023-11-05 |
| mi2023_neighbourhood_r1 | local_mayor_neighbourhood | 2023-10-29 |
| mi2023_neighbourhood_r2 | local_mayor_neighbourhood | 2023-11-05 |
| europe2024_ns | parliament | 2024-06-09 |
| europe2024_ep | european | 2024-06-09 |
| pe202410 | parliament | 2024-10-27 |
| pe202410_ks | parliament | 2024-10-27 |

## Database Schema

Core tables:

- **elections** — slug, name, type, date, round
- **protocols** — per-section protocol data: registered/actual voters, invalid/null votes
- **votes** — per-section per-party vote totals (paper + machine breakdown)
- **preferences** — preferential votes per candidate
- **sections** — polling section metadata (address, EKATTE code, machine count)
- **parties** — party number and name per election
- **candidates** — candidate lists per party per RIK

Geography tables:

- **locations** — deduplicated polling locations with GPS coordinates
- **municipalities**, **districts**, **riks**, **kmetstva**, **local_regions**

## Validation

All 11 national elections (parliament, president, european) are validated against CIK official results with **exact match** — per-party vote totals, protocol aggregates (sections, registered, actual, invalid, null votes). Reference data in `cik_reference.json`, scraped from results.cik.bg.

Local elections (mi2023) are validated via protocol arithmetic and Sofia municipality spot-checks.

## Parsers

One parser file per election group in `parsers/`. Each parser reads raw CIK CSV files and writes to a temporary SQLite database. `build.py` runs them in parallel and merges the results.

```
parsers/
  common.py          # shared utilities, schema, helpers
  pe202410.py        # pe202410 + pe202410_ks
  europe2024.py      # europe2024_ns + europe2024_ep
  ns2023.py          # ns2023
  ns2022.py          # ns2022
  mi2023.py          # 7 mi2023 elections (council, mayor, kmetstvo, neighbourhood × rounds)
  pvrns2021.py       # pvrns2021_ns + pvr_r1 + pvr_r2
  pi2021_jul.py      # pi2021_jul
  pi2021_apr.py      # pi2021_apr
```

## Reference Data

| File | What |
|------|------|
| `cik_reference.json` | CIK official totals for validation (11 national elections) |
| `geography.sql` | Geographic reference: municipalities, oblasts, EKATTE codes |
| `gadm41_BGR_1.json` | GeoJSON — oblast boundaries |
| `gadm41_BGR_2.json` | GeoJSON — municipality boundaries |
| `grao_tab02.txt` | GRAO settlement registry |
| `coalition_members.json` | Coalition → member party mappings |
| `party-metadata.json` | Party colors, abbreviations |
| `party_overrides.json` | Manual party name corrections |

## CIK Source Data

Raw CSV exports from results.cik.bg are distributed as a separate GitHub Release (`cik-exports-2021-2024`) because they're immutable official data (~385MB). Download them into `cik-exports/` before running the pipeline.

The `extract.sh` script extracts the zips. One exception: `pi2021/` has no zip and must be provided as a pre-extracted directory.
