## Why

The `GET /api/elections/:id/results` endpoint returns 500 errors for elections because the SQL query references non-existent columns (`v.party_id`, `v.votes`) instead of the actual schema columns (`v.party_number`, `v.total`), and joins parties incorrectly (by `id` instead of by `election_id + number`). Without API tests, this regression shipped undetected. Adding automated tests and enforcing TDD prevents similar breakage going forward.

## What Changes

- **Fix the results query** in `server/src/routes/elections.ts`: correct the JOIN condition to match on `election_id` + `party_number`/`number`, and replace `SUM(v.votes)` with `SUM(v.total)`.
- **Add an API test suite** (vitest) that hits every election endpoint (`GET /api/elections`, `GET /api/elections/:id/results` for each election) and asserts 200 status + valid JSON structure.
- **Add a `test` script** to `package.json` and configure CI to run tests before deploy.
- **Adopt TDD policy**: all new features must have tests written before implementation.

## Capabilities

### New Capabilities

- `api-testing`: Automated API test suite using vitest that validates all election endpoints return correct responses. Includes test runner configuration, CI integration, and TDD workflow conventions.

### Modified Capabilities

_(none -- no spec-level requirement changes to existing capabilities)_

## Impact

- **No schema changes** to `elections.db`. The fix corrects the SQL to match the existing schema.
- **Code changes**: `server/src/routes/elections.ts` (query fix), new test files in `server/src/__tests__/` or `server/tests/`.
- **New dev dependencies**: `vitest` (and possibly `@hono/node-server` test utilities).
- **CI/CD**: New `test` script in root and/or server `package.json`; CI pipeline must run tests before deploy.
- **Process**: TDD policy documented — tests before implementation for all future changes.
