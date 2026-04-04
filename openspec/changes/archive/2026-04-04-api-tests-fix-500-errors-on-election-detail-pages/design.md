## Context

The `GET /api/elections/:id/results` endpoint has two SQL bugs that cause 500 errors for certain elections:

1. **Wrong JOIN**: `JOIN parties p ON p.id = v.party_id` — the `votes` table has no `party_id` column. Parties are scoped per-election and linked via `party_number` + `election_id`.
2. **Wrong column**: `SUM(v.votes)` — the `votes` table column is `total`, not `votes`.

These errors went undetected because there are no API tests. The project has no test runner configured.

## Goals / Non-Goals

**Goals:**
- Fix the SQL query so all 18 elections return valid results
- Add a vitest-based API test suite covering every election endpoint
- Add a `test` script to `server/package.json`
- Establish TDD as a project convention going forward

**Non-Goals:**
- Frontend/component tests (future work)
- Load testing or performance benchmarking
- Changing the data model or schema
- Adding new API endpoints

## Decisions

### 1. Fix the JOIN to use composite key (election_id + party_number)

**Choice**: Change the JOIN from `parties p ON p.id = v.party_id` to `parties p ON p.election_id = v.election_id AND p.number = v.party_number`. Replace `SUM(v.votes)` with `SUM(v.total)`.

**Rationale**: The `parties` table is per-election — `(election_id, number)` is the natural key that matches `votes.party_number`. Using `parties.id` (the autoincrement PK) was incorrect because it does not correspond to any column in `votes`.

**Alternatives considered**: Adding a `party_id` FK to the votes table — rejected because it would require a schema migration and re-import of all 18 elections for no benefit.

### 2. Vitest over Jest

**Choice**: Use vitest as the test runner.

**Rationale**: The project already uses Vite for the frontend. Vitest shares Vite's config and transform pipeline, supports TypeScript natively without extra config, and is faster than Jest for ESM projects. The feature request also mentions vitest.

**Alternatives considered**: Jest (needs ts-jest or SWC transform, heavier config), node:test (no TypeScript transform).

### 3. Test against a real SQLite database

**Choice**: Tests import the Hono app and use `app.request()` to make in-process HTTP calls against the real `elections.db`.

**Rationale**: The bug is in the SQL query — mocking the database would hide exactly the class of bug we are trying to catch. Hono's `app.request()` avoids needing a running server while still exercising the full request/response pipeline. `better-sqlite3` is synchronous, so tests stay fast.

**Alternatives considered**: Spinning up a real HTTP server (unnecessary overhead), mocking the DB (defeats the purpose).

### 4. Test script in server/package.json

**Choice**: Add `"test": "vitest run"` to `server/package.json`. CI runs `cd server && npm test`.

**Rationale**: Tests live in the server package because the API is what we are testing. Keeps the test runner scoped. A root-level script can delegate if needed later.

## Risks / Trade-offs

- **[Risk] Tests depend on elections.db existing at repo root** -> Mitigation: Tests skip gracefully or fail with a clear message if DB is missing. CI must download the DB from releases before running tests.
- **[Risk] Tests are coupled to current data** -> Mitigation: Tests assert structural correctness (status 200, JSON shape, non-empty results) rather than exact vote counts, so they survive data updates.
- **[Trade-off] No separate test DB** -> Keeps setup simple but means tests read production data. Acceptable because the DB is read-only and deterministic.
