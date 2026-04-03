## ADDED Requirements

### Requirement: All 2021+ elections present in database
The database SHALL contain all Bulgarian elections from April 2021 onward, including parliament, president, european, and local types.

#### Scenario: Complete election set after build
- **WHEN** the database is built with the 2021+ parser set
- **THEN** the following elections exist in the `elections` table:
  - pi2021_apr (parliament, 2021-04-04)
  - pi2021_jul (parliament, 2021-07-11)
  - pvrns2021_ns (parliament, 2021-11-14)
  - pvrns2021_pvr_r1 (president, 2021-11-14)
  - pvrns2021_pvr_r2 (president, 2021-11-21)
  - ns2022 (parliament, 2022-10-02)
  - ns2023 (parliament, 2023-04-02)
  - mi2023_council (local_council, 2023-10-29)
  - mi2023_mayor_r1 (local_mayor, 2023-10-29)
  - mi2023_kmetstvo_r1 (local_mayor_kmetstvo, 2023-10-29)
  - mi2023_neighbourhood_r1 (local_mayor_neighbourhood, 2023-10-29)
  - mi2023_neighbourhood_r2 (local_mayor_neighbourhood, 2023-11-05)
  - europe2024_ns (parliament, 2024-06-09)
  - europe2024_ep (european, 2024-06-09)
  - pe202410 (parliament, 2024-10-27)
  - pe202410_ks (parliament, 2024-10-27)

### Requirement: Protocol arithmetic consistency
For every election, the sum of invalid votes, null votes, and party votes per section SHALL approximately equal the actual voter count from the protocol.

#### Scenario: Gap within tolerance
- **WHEN** `validate.py` computes `invalid + null_votes + SUM(party_votes) - actual_voters` per election
- **THEN** the gap percentage is below 5% for all elections (gap > 5% is an ERROR)

### Requirement: CIK official totals match for national elections
For parliament, president, and european elections, the database totals SHALL match CIK published results exactly.

Reference data in `cik_reference.json` is scraped from results.cik.bg and contains:
- `protocol` — standardized field names (sections, registered, actual, invalid, null_votes) mapped from CIK's per-election field numbering
- `protocol_summary` — raw CIK protocol aggregate fields with original keys (А, Б, 1, 2, 3, 4а, etc.) for full audit trail
- `party_votes_total` — sum of per-party votes from CIK results page
- `parties` — per-party vote breakdown (the validation ground truth)

Note: Two elections have `invalid_votes` where the CIK CSV export differs from the CIK website (post-hoc corrections not backported to CSV). These are documented in `protocol._invalid_note` and validated against the CSV value.

#### Scenario: Section count matches CIK
- **WHEN** `validate_cik.py` compares `COUNT(DISTINCT section_code)` against `cik_reference.json`
- **THEN** the section count matches exactly for all 11 national elections

#### Scenario: Protocol aggregates match CIK
- **WHEN** `validate_cik.py` compares `SUM(registered_voters)`, `SUM(actual_voters)`, `SUM(invalid_votes)`, `SUM(null_votes)` against `cik_reference.json`
- **THEN** all totals match exactly for all 11 national elections

#### Scenario: Per-party vote totals match CIK
- **WHEN** `validate_cik.py` compares `SUM(total)` per `party_number` against `cik_reference.json` party data
- **THEN** all parties listed on CIK results page match exactly (0 errors across all elections)
- **AND** extra DB parties not on CIK (unlisted independents) are reported as warnings

### Requirement: CIK reference data exists for all national elections
The `cik_reference.json` file SHALL contain reference data for every parliament, president, and european election in the 2021+ set (11 elections total).

#### Scenario: All national elections have CIK reference
- **WHEN** the database is built with 2021+ elections
- **THEN** `cik_reference.json` has entries for all 11 national elections: pi2021_apr, pi2021_jul, pvrns2021_pvr_r1, pvrns2021_pvr_r2, pvrns2021_ns, ns2022, ns2023, europe2024_ep, europe2024_ns, pe202410, pe202410_ks
- **AND** each entry has protocol aggregates, per-party vote totals (including independent candidates), and raw CIK protocol summary fields

### Requirement: Local election validation via Sofia spot-checks
Local elections (mi2023) do not have CIK national aggregates. They SHALL be validated using Sofia municipality spot-checks against CIK per-municipality results, plus protocol arithmetic.

#### Scenario: mi2023 elections pass arithmetic check
- **WHEN** `validate.py` runs on mi2023 elections
- **THEN** all 5 mi2023 elections have gap percentage below 5%

#### Scenario: Sofia council votes match CIK
- **WHEN** mi2023_council total party votes for Sofia municipality are compared to CIK results page
- **THEN** the totals match

#### Scenario: Sofia mayor votes match CIK
- **WHEN** mi2023_mayor_r1 total votes per candidate for Sofia municipality are compared to CIK results page
- **THEN** the totals match

#### Scenario: Sofia kmetstvo votes match CIK
- **WHEN** mi2023_kmetstvo_r1 votes for one Sofia kmetstvo (e.g. Bankya) are compared to CIK results page
- **THEN** the totals match

#### Scenario: Sofia neighbourhood votes match CIK
- **WHEN** mi2023_neighbourhood_r1 votes for one Sofia rayon (e.g. Lozenets) are compared to CIK results page
- **THEN** the totals match

#### Scenario: Sofia neighbourhood runoff votes match CIK
- **WHEN** mi2023_neighbourhood_r2 votes for one Sofia rayon runoff are compared to CIK results page
- **THEN** the totals match
