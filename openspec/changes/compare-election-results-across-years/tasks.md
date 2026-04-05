## 1. API endpoint

- [ ] 1.1 Add `GET /api/elections/compare` route in `server/src/routes/elections.ts` that parses the `elections` query parameter (comma-separated IDs) and validates: at least 2, at most 10, all numeric
- [ ] 1.2 Implement election existence check — query the `elections` table for all requested IDs, return 404 if any are missing
- [ ] 1.3 Implement geographic filter parsing reusing the same precedence logic as the existing `/:id/results` route (kmetstvo > local_region > municipality > district > rik)
- [ ] 1.4 Implement the comparison SQL query: join `votes` → `election_parties` → `parties`, group by `parties.id` and `election_id`, compute `SUM(v.total)` per group, with optional geographic filter join through `sections` → `locations`
- [ ] 1.5 Compute percentages server-side: for each election, divide party votes by total valid votes (sum of all party votes in that election/filter), round to 1 decimal place
- [ ] 1.6 Assemble the response: `elections` array (metadata), `results` array sorted by total votes descending, with per-party `elections` object containing `votes` and `percentage` — fill missing elections with `{ votes: 0, percentage: 0 }`

## 2. API tests

- [ ] 2.1 Add test for successful comparison of 2 elections: verify response structure, presence of `elections` and `results` arrays, percentage values between 0–100
- [ ] 2.2 Add test for geographic filter: compare with `district` param and verify results are scoped
- [ ] 2.3 Add test for validation errors: fewer than 2 elections (400), more than 10 (400), missing param (400), non-existent ID (404)
- [ ] 2.4 Add test that percentages sum to approximately 100 for each election in the response
- [ ] 2.5 Validate that parties appearing in only one election show `votes: 0` for the other

## 3. Frontend dependencies

- [ ] 3.1 Install `chart.js` and `react-chartjs-2` in the `web/` package
- [ ] 3.2 Verify the dev build compiles with the new dependency

## 4. Compare page frontend

- [ ] 4.1 Create `web/src/pages/compare-elections.tsx` with election multi-select UI: fetch election list from `GET /api/elections`, render checkboxes, store selected IDs in URL search params (`?elections=1,17`)
- [ ] 4.2 Integrate `LocationFilter` component for geographic filtering on the compare page
- [ ] 4.3 Fetch comparison data from `GET /api/elections/compare` when 2+ elections are selected, handle loading and error states
- [ ] 4.4 Render grouped bar chart using `react-chartjs-2` `Bar` component: one group per party (top 15 by votes), one bar per election year, bars showing percentage vote share, color-coded with legend
- [ ] 4.5 Add route `/compare` in `web/src/main.tsx` pointing to the new page component
- [ ] 4.6 Add navigation link to `/compare` on the election list page (`web/src/pages/election-list.tsx`)

## 5. Integration verification

- [ ] 5.1 Run existing API tests to confirm no regressions in the `/:id/results` endpoint
- [ ] 5.2 Run new comparison API tests and verify all pass
- [ ] 5.3 Verify frontend builds without errors (`npm run build` in `web/`)
