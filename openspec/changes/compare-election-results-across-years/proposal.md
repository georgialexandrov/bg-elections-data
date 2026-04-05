## Why

The platform currently shows results for one election at a time. Users cannot compare how parties performed across multiple elections for the same geographic area — the most common analytical question in election data ("How did party X's vote share change between 2021 and 2024?"). Adding cross-election comparison with percentage-based visualization unlocks trend analysis, the core value proposition for researchers, journalists, and civic organizations.

## What Changes

- Add a new `GET /api/elections/compare` endpoint that accepts multiple election IDs and optional geographic filters, returning per-party vote totals and percentage shares for each requested election.
- Add a new frontend page at `/compare` with election multi-select, geographic filtering (reusing the existing `LocationFilter` component), and a grouped bar chart (one group per party, one bar per election year) rendered with a lightweight chart library.
- Add a navigation entry to link to the comparison page from the election list.
- No changes to `elections.db` schema — all required data (votes, parties, protocols) already exists and is linked to elections and geographic entities.

## Capabilities

### New Capabilities
- `election-comparison`: API endpoint and frontend page for comparing party vote shares across 2+ elections, with percentage calculations, grouped bar chart visualization, and optional geographic filtering.

### Modified Capabilities

## Impact

- **API** (`server/src/routes/elections.ts`): New `/compare` route accepting `elections` (comma-separated IDs), plus existing geographic filter params (`rik`, `district`, `municipality`, `kmetstvo`, `local_region`). Returns per-election, per-party vote totals and percentages.
- **Frontend** (`web/src/pages/`): New `compare-elections.tsx` page with multi-select for elections, geographic filters, and chart rendering.
- **Dependencies** (`web/package.json`): Add a lightweight chart library (e.g., Chart.js or Recharts) for grouped bar chart visualization.
- **Database schema**: No changes. Existing `votes`, `parties`, and `protocols` tables already contain all data needed for cross-election comparison.
- **Performance**: The comparison query runs the same aggregation as the existing results endpoint but for multiple elections in one query. Indexed foreign keys keep this fast.
