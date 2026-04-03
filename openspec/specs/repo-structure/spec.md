## ADDED Requirements

### Requirement: Internal directory for non-public files
The repository SHALL have a `.internal/` directory at the root that is excluded from the public repository via `.gitignore`.

#### Scenario: .internal/ is gitignored
- **WHEN** a contributor clones the public repository
- **THEN** the `.internal/` directory does not exist in the clone

#### Scenario: .internal/ contains parsers
- **WHEN** a maintainer has the `.internal/` directory
- **THEN** all parser modules (previously `data/parsers/`) are located at `.internal/parsers/`

#### Scenario: .internal/ contains raw CIK data
- **WHEN** a maintainer has the `.internal/` directory
- **THEN** all CIK export archives and extracted data are located at `.internal/cik-exports/`

#### Scenario: .internal/ contains build pipeline
- **WHEN** a maintainer has the `.internal/` directory
- **THEN** `build.py` and `import.sh` are located in `.internal/`

#### Scenario: .internal/ contains planning docs
- **WHEN** a maintainer has the `.internal/` directory
- **THEN** the following documents exist:
  - `.internal/elections-calendar.md` (election dates, types, rounds)
  - `.internal/release-plan.md` (roadmap and deadlines)
  - `.internal/data-sources.md` (CIK URLs and data provenance)

### Requirement: Public data directory retains validation and reference files
The `data/` directory SHALL keep files needed for public validation and geography.

#### Scenario: Validation scripts are public
- **WHEN** a contributor clones the repository
- **THEN** `data/validate.py` and `data/validate_cik.py` exist and can run against `elections.db`

#### Scenario: CIK reference data is public
- **WHEN** a contributor clones the repository
- **THEN** `data/cik_reference.json` exists with reference data for all 2021+ national elections

#### Scenario: Geography data is public
- **WHEN** a contributor clones the repository
- **THEN** `data/geography.sql` and geo scripts exist

### Requirement: Build pipeline imports only 2021+ elections
The build pipeline SHALL default to importing only elections from April 2021 onward.

#### Scenario: Default build produces 2021+ database
- **WHEN** a maintainer runs `python .internal/build.py`
- **THEN** `elections.db` contains only elections with date >= 2021-04-04

#### Scenario: Full build available with flag
- **WHEN** a maintainer runs `python .internal/build.py --all`
- **THEN** `elections.db` contains all elections (1991-2024)

### Requirement: CLAUDE.md references .internal/
The project CLAUDE.md SHALL document the `.internal/` directory so AI assistants have context about the build pipeline and planning docs.

#### Scenario: CLAUDE.md includes .internal/ reference
- **WHEN** an AI assistant reads CLAUDE.md
- **THEN** it knows about `.internal/` and its contents (parsers, build pipeline, planning docs)

### Requirement: Database ships in the repo
The `elections.db` file SHALL be committed to the repository (not gitignored) so users get data on clone.

#### Scenario: Clone includes database
- **WHEN** a contributor clones the repository
- **THEN** `elections.db` exists at the repo root with 2021+ election data
