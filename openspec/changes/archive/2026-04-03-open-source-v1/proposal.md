## Why

The project has 30 years of Bulgarian election data but most of it is unvalidated. Open-sourcing everything invites scrutiny on data we're not confident in. We need to ship a smaller, correct dataset — 2021+ elections — where every number is verified against CIK official results. The next elections are April 17, 2026; the data and tools need to be public before then.

## What Changes

- Import missing 2021+ elections into the database: ns2023 (parliament Apr 2023) and mi2023 (5 local elections Oct/Nov 2023)
- Include pe202410_ks (constitutional court) data for the October 2024 election
- Validate all 2021+ elections against CIK official results (per-party vote totals, protocol aggregates)
- Move parsers and raw CIK export data into `.internal/` (gitignored) — only open-source code we're confident in
- Adjust `build.py` to only import 2021+ elections
- Create `.internal/` directory for planning docs (election calendar, release plan, data sources)
- Configure OpenSpec for future feature work

## Capabilities

### New Capabilities
- `data-integrity`: Validation rules and process ensuring all public election data matches CIK official results. Covers protocol arithmetic, per-party vote totals, section counts, and registered/actual voter counts.
- `repo-structure`: Repository organization separating public open-source code from internal build tooling. Defines what's public, what's in `.internal/`, and how the build pipeline works.

### Modified Capabilities
<!-- No existing specs to modify -->

## Impact

- `data/build.py` — parser module list reduced to 2021+ only, import paths updated for `.internal/parsers/`
- `data/parsers/` — moved to `.internal/parsers/`
- `data/cik-exports/` — moved to `.internal/cik-exports/`
- `.gitignore` — updated to include `.internal/`
- `elections.db` — rebuilt with only 2021+ data (~17 elections instead of ~52)
- `data/cik_reference.json` — needs ns2023 and mi2023 reference data added
- `openspec/config.yaml` — filled with project context
