## Context

The platform displays election results one election at a time via `GET /api/elections/:id/results`. The frontend renders results in a plain HTML table. There is no cross-election comparison capability, and no chart library is installed. The database contains 18 elections (2021–2024) with full geographic linkage. Party names vary across elections (coalitions form/dissolve), but the `parties` table provides a stable `canonical_name` via `election_parties.party_id`.

## Goals / Non-Goals

**Goals:**
- API endpoint that returns vote totals and percentage shares for 2+ elections in a single request
- Party matching across elections using the existing `parties.id` / `canonical_name` mapping
- Grouped bar chart visualization (one group per party, one bar per election)
- Reuse existing geographic filter parameters and `LocationFilter` component
- Keep the chart dependency lightweight — no heavy D3-based libraries

**Non-Goals:**
- Time-series line charts or trend analysis beyond bar comparison
- Party merge/split tracking (e.g., "ГЕРБ" + "ГЕРБ-СДС" treated as separate parties)
- Comparison of voter turnout or protocol-level statistics
- Server-side chart rendering or image export
- Changes to the database schema

## Decisions

### 1. API shape: single `/api/elections/compare` endpoint

Accept election IDs as a comma-separated query parameter: `?elections=1,13,17`. Reuse the same geographic filter params (`rik`, `district`, `municipality`, `kmetstvo`, `local_region`) with the same precedence logic as the existing results endpoint.

**Response structure:**
```json
{
  "elections": [
    { "id": 1, "name": "...", "date": "2024-10-27", "type": "parliament" },
    { "id": 17, "name": "...", "date": "2021-07-11", "type": "parliament" }
  ],
  "results": [
    {
      "party_id": 5,
      "party_name": "ГЕРБ-СДС",
      "elections": {
        "1": { "votes": 654321, "percentage": 25.4 },
        "17": { "votes": 543210, "percentage": 22.1 }
      }
    }
  ]
}
```

**Alternative considered:** Separate requests per election and client-side merging. Rejected because percentage calculation requires knowing total valid votes per election, adding complexity to the frontend and causing multiple round-trips.

### 2. Percentage calculation: votes / total valid votes per election

Percentage = `party_votes / SUM(all_party_votes)` for that election (within the geographic filter). This matches how CIK reports percentages. Computed server-side in the SQL query using window functions.

**Alternative considered:** Using `actual_voters` from protocols as denominator. Rejected because it includes invalid/null ballots, making percentages inconsistent with official CIK reporting.

### 3. Chart library: Chart.js with react-chartjs-2

Chart.js is ~60KB gzipped (tree-shakeable), widely maintained, and has first-class support for grouped bar charts. The `react-chartjs-2` wrapper provides a declarative React API.

**Alternative considered:** Recharts (~45KB gzipped) — good React integration but less performant with many data points and more opinionated about styling. Chart.js provides more control over grouped bar configuration.

### 4. Party matching across elections: use `parties.id`

The existing `election_parties` → `parties` join already maps per-election ballot names to stable party IDs with `canonical_name`. The comparison endpoint groups by `parties.id` and uses `canonical_name` as the display name. A party appearing in only some of the selected elections shows zero/null for the others.

### 5. Frontend routing: `/compare` page

New page component at `web/src/pages/compare-elections.tsx`. The election list page gets a link to `/compare`. Elections are selected via checkboxes or multi-select, stored as URL search params (`?elections=1,13,17`) for shareability. The `LocationFilter` component is reused as-is.

### 6. Validation: require 2–10 election IDs

The API validates that at least 2 and at most 10 election IDs are provided, and that all IDs exist. Returns 400 for invalid input. This bounds query complexity and chart readability.

## Risks / Trade-offs

- **Party name differences across elections** → Mitigated by using `canonical_name` from the `parties` table, which normalizes names. Users may still find it confusing when coalition names change. This is a data quality concern outside this feature's scope.
- **Chart readability with many parties** → Mitigated by sorting results by highest total votes across selected elections and allowing the chart to scroll. The 10-election limit also helps.
- **New dependency (Chart.js)** → Small footprint (~60KB gzipped), MIT licensed, actively maintained. Acceptable trade-off for the visualization value.
- **Query performance with many elections + geo filter** → The query uses indexed joins and GROUP BY. With 10 elections max and geographic filtering narrowing the dataset, performance should be well under 1 second.
