## Context

The DB currently has 52 elections (1991-2024), built by 20+ parser modules from raw CIK CSV exports. Two parsers (ns2023, mi2023) are registered in `build.py` but their elections are missing from the current DB — likely not rebuilt since those parsers were added. All 2021+ elections have CIK reference data for validation except mi2023 (local elections lack national aggregates from CIK).

The build pipeline: `data/build.py` runs each parser in parallel → each writes a temp SQLite DB → merge into `elections.db`. Parsers live in `data/parsers/`, raw data in `data/cik-exports/`.

## Goals / Non-Goals

**Goals:**
- Ship a public database with ~17 validated elections (2021-2024)
- Every public election verified: `SUM(section_votes) == CIK_official` per party
- Clear separation: public repo has the DB + validation + app code; `.internal/` has build tooling
- Reproducible builds for maintainers who have `.internal/`

**Non-Goals:**
- Pre-2021 data cleanup or validation (kept in `.internal/` for future work)
- New features, anomaly detection, or frontend changes
- Public-facing build pipeline (contributors don't need to rebuild the DB)

## Decisions

### 1. `.internal/` as the private directory

**Choice:** Single `.internal/` directory at repo root, added to `.gitignore`.

**Why not `data/parsers/` staying in place with individual gitignores?** Too granular — every new parser or data file needs a gitignore entry. A single directory is cleaner and matches the mental model: "everything private is in one place."

**Structure:**
```
.internal/
  parsers/                  # moved from data/parsers/
    common.py
    pe202410.py
    europe2024.py
    ns2023.py
    mi2023.py
    pvrns2021.py
    pi2021_jul.py
    pi2021_apr.py
    ...                     # pre-2021 parsers kept here too
  cik-exports/              # moved from data/cik-exports/
    ns2023/
    mi2023_tur1/
    mi2023_tur2/
    ...
  build.py                  # moved from data/build.py (needs parsers)
  import.sh                 # moved from data/import.sh
  elections-calendar.md     # dates, types, rounds for all elections
  release-plan.md           # roadmap, deadlines
  data-sources.md           # CIK URLs, how data was obtained
```

### 2. Build pipeline adjustment

**Choice:** Move `build.py` into `.internal/` alongside parsers. Create a reduced `PARSER_MODULES` list (2021+ only) as the default. Keep all parser files — maintainers can still build the full 1991-2024 DB with a `--all` flag.

**Why move build.py?** It imports from `parsers.common`, `parsers.pe202410`, etc. Moving it alongside the parsers avoids path hacking. The public repo ships a pre-built `elections.db`.

**What stays in `data/`:**
- `validate.py`, `validate_cik.py` — anyone can verify the DB
- `cik_reference.json` — the reference data for validation
- `geography.sql` — geography reference tables
- `party_overrides.json`, `party-metadata.json`, `coalition_members.json` — party normalization data
- Geo scripts (`build_geography.py`, `import_geo.py`, etc.)

### 3. mi2023 validation approach

**Choice:** Sofia spot-checks across all local election types. CIK doesn't publish national aggregates for local elections — only per-municipality results pages.

**Approach:** Validate mi2023 using Sofia (largest municipality, covers all types) with manual spot-checks against CIK per-municipality results pages. Five checks, one per election type:
1. **mi2023_council** — Sofia общински съветници: total party votes match CIK
2. **mi2023_mayor_r1** — Sofia кмет: total votes per candidate match CIK
3. **mi2023_kmetstvo_r1** — one Sofia кметство (e.g. Банкя): votes match CIK
4. **mi2023_neighbourhood_r1** — one Sofia район (e.g. Лозенец): votes match CIK
5. **mi2023_neighbourhood_r2** — one Sofia район runoff: votes match CIK

Plus protocol arithmetic check (validate.py) for all mi2023 elections as a baseline.

### 4. elections.db in the repo vs release artifact

**Choice:** Ship `elections.db` in the repo (not gitignored). It's ~50-100MB for 2021+ data. If too large for git, use GitHub Releases or Git LFS.

**Why in the repo?** `git clone` and you have everything. No extra download step. For a civic data project targeting journalists and observers, simplicity matters more than repo size elegance.

## Risks / Trade-offs

- **mi2023 validation gap** → Mitigation: protocol arithmetic check + 5 Sofia spot-checks (one per election type) against CIK per-municipality results.
- **ns2023 parser may fail** → Mitigation: test build with `python build.py ns2023` before the full restructure. Fix parser issues first.
- **DB size in git** → Mitigation: 2021+ only keeps it manageable (~50MB). Monitor after first build. Move to LFS or releases if needed.
- **Contributors can't rebuild** → Mitigation: validation scripts prove correctness. Schema is documented. Only maintainers with `.internal/` need to rebuild.
