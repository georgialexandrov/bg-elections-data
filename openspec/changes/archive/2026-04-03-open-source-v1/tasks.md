## 1. Fix missing elections data

- [x] 1.1 Test-build ns2023 parser: `python data/build.py ns2023` — verify it succeeds and produces correct election data
- [x] 1.2 Test-build mi2023 parser: `python data/build.py mi2023` — verify it succeeds and produces all 7 local elections (added mayor_r2 + kmetstvo_r2)
- [x] 1.3 Add ns2023 CIK reference data to `data/cik_reference.json` (already present)
- [x] 1.4 Run full build with all 2021+ parsers, verify all 18 elections present in DB

## 2. Validate all 2021+ elections

- [x] 2.1 Run `python data/validate.py` — all 2021+ elections pass protocol arithmetic (gap 0.0-0.2%)
- [x] 2.2 Run `python data/validate_cik.py` — all national elections match CIK reference (0 errors, warnings within tolerance)
- [x] 2.3 Spot-check mi2023_council: Sofia top5 parties exact match vs CIK (#42=36,388 #21=14,675 etc)
- [x] 2.4 Spot-check mi2023_mayor_r1: Sofia all candidates exact match vs CIK (#85=119,121 #86=80,875 #76=66,792)
- [x] 2.5 Spot-check mi2023_kmetstvo_r1: Лозен exact match vs CIK (total=1,887, #76=1,351, #85=349)
- [x] 2.6 Spot-check mi2023_neighbourhood_r1: Средец exact match vs CIK (#85=6,138 #76=1,501 #86=1,126)
- [x] 2.7 Spot-check mi2023_neighbourhood_r2: Студентски exact match vs CIK (#80=5,496 #85=4,632 total=10,128)
- [x] 2.8 No validation errors — all checks passed

## 3. Restructure repo — create .internal/

- [x] 3.1 Create `.internal/` directory structure: `parsers/`, `cik-exports/`
- [x] 3.2 Copy `data/parsers/` → `.internal/parsers/`
- [x] 3.3 Copy `data/cik-exports/` → `.internal/cik-exports/`
- [x] 3.4 Copy `data/build.py` → `.internal/build.py`
- [x] 3.5 Copy `data/import.sh` → `.internal/import.sh`
- [x] 3.6 Update `.internal/build.py`: sys.path for parsers, PARSER_MODULES_2021 default, --all flag, geography path fix
- [x] 3.7 Update `.internal/import.sh`: pass --all flag, use $DATA_DIR for normalize/validate scripts
- [x] 3.8 Verified `data/validate.py` and `data/validate_cik.py` paths — already correct (parent.parent / elections.db)

## 4. Update .gitignore and CLAUDE.md

- [x] 4.1 Add `.internal/` to `.gitignore`
- [x] 4.2 Remove `elections.db` from `.gitignore` (ship the DB in the repo)
- [x] 4.3 Kept `data/cik-exports/*` entries in `.gitignore` (source zips still in data/, extracted dirs still gitignored)
- [x] 4.4 Update `CLAUDE.md` — add `.internal/` to project structure, document what's in it
- [x] 4.5 Updated project structure: removed old `results/` reference, added `data/`, `.internal/`, `openspec/`

## 5. Create .internal/ planning docs

- [x] 5.1 Create `.internal/elections-calendar.md` — all 18 elections with dates, types, rounds, sections
- [x] 5.2 Create `.internal/release-plan.md` — V1 scope, phases, future plans
- [x] 5.3 Create `.internal/data-sources.md` — CIK URLs, encoding issues, validation reference

## 6. Configure OpenSpec

- [x] 6.1 Fill `openspec/config.yaml` with project context: tech stack, data model, election types, conventions

## 7. Final validation and rebuild

- [x] 7.1 Rebuild `elections.db` from `.internal/build.py` — 18 elections, 2021+ only
- [x] 7.2 Run both validation scripts — all green (0 errors, warnings within tolerance)
- [x] 7.3 Verified validate.py and validate_cik.py work with paths relative to data/ (no .internal/ dependency)
- [x] 7.4 Test `--all` flag — 60 elections built (21/21 parsers OK)

## 8. CIK validation hardening — exact match

- [x] 8.1 Scraped all 11 national election results from results.cik.bg (protocol summaries + per-party breakdowns)
- [x] 8.2 Rebuilt `cik_reference.json`: added raw `protocol_summary` fields, standardized `protocol` mapping, `party_votes_total` as sum of per-party (not protocol 6.1 aggregate), `_urls` for provenance
- [x] 8.3 Added missing independent candidates to reference (5 elections: pi2021_apr party 31, pi2021_jul party 24, ns2022 party 30, ns2023 party 22, pe202410 party 29)
- [x] 8.4 Fixed pe202410_ks reference — old values were wrong for 4 parties (25-28), updated from CIK KS correction page
- [x] 8.5 Rewrote `validate_cik.py` — checks per-party exact match, protocol aggregates, flags extra DB parties as warnings
- [x] 8.6 Fixed null_votes parser bug in 8 parsers — machine null_votes from form 26/30 (paper+machine) sections were dropped because `UPDATE ... WHERE null_votes IS NULL` skipped sections with existing paper null. Changed to `COALESCE(null_votes, 0) + ?`
- [x] 8.7 Updated invalid_votes reference for 2 elections where CIK CSV differs from CIK website (pvrns2021_pvr_r2, ns2023) — documented as known CIK post-hoc corrections
- [x] 8.8 Final validation: ALL CHECKS PASSED — 0 errors, 4 warnings (2 unlisted independent candidates in DB)
