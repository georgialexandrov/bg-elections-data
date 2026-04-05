## ADDED Requirements

### Requirement: Compare election results API endpoint
The system SHALL provide a `GET /api/elections/compare` endpoint that accepts multiple election IDs and returns per-party vote totals and percentage shares for each election.

#### Scenario: Successful comparison of two parliament elections
- **WHEN** a client sends `GET /api/elections/compare?elections=1,17`
- **THEN** the response status is 200
- **AND** the response contains an `elections` array with metadata for both elections (id, name, date, type)
- **AND** the response contains a `results` array where each entry has `party_id`, `party_name`, and an `elections` object keyed by election ID
- **AND** each election entry within a party result contains `votes` (integer) and `percentage` (number, 0–100)

#### Scenario: Comparison with geographic filter
- **WHEN** a client sends `GET /api/elections/compare?elections=1,17&district=3`
- **THEN** the response contains vote totals and percentages scoped to district 3 only
- **AND** the geographic filter precedence matches the existing results endpoint (kmetstvo > local_region > municipality > district > rik)

#### Scenario: Party appears in only some elections
- **WHEN** a party participated in election A but not election B
- **THEN** the party's entry in the results SHALL include an entry for election B with `votes: 0` and `percentage: 0`

#### Scenario: Fewer than 2 election IDs provided
- **WHEN** a client sends `GET /api/elections/compare?elections=1`
- **THEN** the response status is 400
- **AND** the response contains an error message indicating at least 2 elections are required

#### Scenario: More than 10 election IDs provided
- **WHEN** a client sends `GET /api/elections/compare` with more than 10 election IDs
- **THEN** the response status is 400
- **AND** the response contains an error message indicating the maximum is 10 elections

#### Scenario: Non-existent election ID
- **WHEN** a client sends `GET /api/elections/compare?elections=1,9999`
- **THEN** the response status is 404
- **AND** the response contains an error message indicating which election ID was not found

#### Scenario: Missing elections parameter
- **WHEN** a client sends `GET /api/elections/compare` without the `elections` query parameter
- **THEN** the response status is 400

### Requirement: Percentage calculation uses valid votes as denominator
The percentage for each party in a given election SHALL be calculated as `(party_votes / total_valid_votes) * 100`, where `total_valid_votes` is the sum of all party votes for that election within the applied geographic filter.

#### Scenario: Percentages sum to approximately 100
- **WHEN** results are returned for an election in a comparison
- **THEN** the sum of all party percentages for that election SHALL be between 99.9 and 100.1 (accounting for rounding)

#### Scenario: Percentage rounds to one decimal place
- **WHEN** a party's percentage is calculated
- **THEN** the value SHALL be rounded to one decimal place

### Requirement: Party matching uses canonical party identity
The comparison endpoint SHALL group results by `parties.id` and display `parties.canonical_name`, ensuring consistent party identity across elections regardless of per-election ballot name variations.

#### Scenario: Same party with different ballot names across elections
- **WHEN** a party has `name_on_ballot` "ГЕРБ" in election A and "ГЕРБ-СДС" in election B but the same `party_id`
- **THEN** the comparison result uses a single `party_name` (the canonical name) with vote data for both elections

### Requirement: Results ordered by total votes
The results array SHALL be ordered by the sum of votes across all selected elections in descending order, so the most significant parties appear first.

#### Scenario: Party ordering in response
- **WHEN** results are returned for a comparison of elections A and B
- **THEN** parties are sorted by `SUM(votes across A + B)` descending

### Requirement: Compare elections frontend page
The system SHALL provide a `/compare` page that allows users to select 2 or more elections and view a grouped bar chart comparing party vote shares.

#### Scenario: User selects elections and views chart
- **WHEN** a user navigates to `/compare` and selects 2 or more elections
- **THEN** a grouped bar chart is displayed with one group per party and one bar per election
- **AND** bars represent percentage vote share
- **AND** each election is distinguished by color with a legend

#### Scenario: Election selection persisted in URL
- **WHEN** a user selects elections on the compare page
- **THEN** the selected election IDs are stored as URL search parameters (`?elections=1,17`)
- **AND** sharing the URL reproduces the same comparison view

#### Scenario: Geographic filter on compare page
- **WHEN** a user applies a geographic filter on the compare page
- **THEN** the chart updates to show results scoped to the selected geographic area
- **AND** the filter uses the same `LocationFilter` component as the election results page

#### Scenario: Navigation to compare page
- **WHEN** a user is on the election list page
- **THEN** a link to the compare page is visible

#### Scenario: Loading and error states
- **WHEN** the comparison data is being fetched
- **THEN** a loading indicator is displayed
- **WHEN** the API returns an error
- **THEN** an error message is displayed to the user
