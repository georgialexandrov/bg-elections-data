## ADDED Requirements

### Requirement: Election list endpoint returns valid JSON array

The `GET /api/elections` endpoint SHALL return HTTP 200 with a JSON array of election objects. Each object MUST contain `id`, `name`, `date`, and `type` fields.

#### Scenario: Fetch all elections

- **WHEN** a GET request is made to `/api/elections`
- **THEN** the response status is 200, the body is a JSON array with length >= 1, and each element has `id` (number), `name` (string), `date` (string), and `type` (string)

### Requirement: Election results endpoint returns valid JSON for every election

The `GET /api/elections/:id/results` endpoint SHALL return HTTP 200 with a JSON object containing `election` and `results` fields for every election in the database. The `election` field MUST contain `id`, `name`, `date`, and `type`. The `results` field MUST be an array of party result objects.

#### Scenario: Fetch results for each election

- **WHEN** a GET request is made to `/api/elections/:id/results` for each election ID returned by the list endpoint
- **THEN** the response status is 200, the body contains an `election` object with `id`, `name`, `date`, `type`, and a `results` array where each element has `party_id` (number), `party_name` (string), and `total_votes` (number)

#### Scenario: Fetch results for non-existent election

- **WHEN** a GET request is made to `/api/elections/999999/results`
- **THEN** the response status is 404 and the body contains an `error` field

### Requirement: Election results query uses correct schema columns

The SQL query for election results SHALL join the `votes` table to the `parties` table using `election_id` and `party_number`/`number` (not `party_id`/`id`). The vote aggregation SHALL sum the `total` column (not a non-existent `votes` column).

#### Scenario: Results query matches actual schema

- **WHEN** the results endpoint is called for any election that has votes and parties data
- **THEN** the response succeeds (no 500 error) and `results` is a non-empty array with correct `total_votes` values

### Requirement: Test script exists in package.json

The `server/package.json` MUST include a `test` script that runs the API test suite. Running `npm test` in the `server/` directory SHALL execute all tests and exit with code 0 when tests pass.

#### Scenario: Run test suite

- **WHEN** `npm test` is executed in the `server/` directory
- **THEN** all API tests run and the process exits with code 0

### Requirement: TDD workflow for new features

All new features MUST have tests written before implementation code. Pull requests without corresponding tests SHALL NOT be merged.

#### Scenario: New endpoint added without tests

- **WHEN** a pull request adds a new API endpoint without a corresponding test
- **THEN** the PR review process rejects the change until tests are added
