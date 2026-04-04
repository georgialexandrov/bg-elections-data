## 1. Project Setup

- [ ] 1.1 Create root `package.json` with npm workspaces (`server/`, `web/`)
- [ ] 1.2 Create `server/package.json` with dependencies: `hono`, `better-sqlite3`, `@hono/node-server`
- [ ] 1.3 Create `web/package.json` with dependencies: `react`, `react-dom`, `react-router`, `vite`, `@vitejs/plugin-react`
- [ ] 1.4 Add TypeScript config files (`tsconfig.json`) for both server and web
- [ ] 1.5 Validate setup by running `npm install` successfully from root

## 2. API Server

- [ ] 2.1 Create `server/src/db.ts` — open `elections.db` with `better-sqlite3`, export db instance with startup check
- [ ] 2.2 Create `server/src/routes/elections.ts` — implement `GET /api/elections` returning list of elections (id, name, date, type)
- [ ] 2.3 Implement `GET /api/elections/:id/results` in the same routes file — sum votes per party with party names, sorted by total votes descending
- [ ] 2.4 Create `server/src/index.ts` — Hono app mounting election routes, serving Vite build output for non-API routes
- [ ] 2.5 Validate API by starting server and confirming both endpoints return correct JSON against `elections.db`

## 3. SPA Frontend

- [ ] 3.1 Create `web/vite.config.ts` with React plugin and `/api` proxy to Hono dev server
- [ ] 3.2 Create `web/index.html` entry point and `web/src/main.tsx` with React Router setup
- [ ] 3.3 Create `web/src/pages/election-list.tsx` — fetch and display elections as clickable links
- [ ] 3.4 Create `web/src/pages/election-results.tsx` — fetch and display votes per party in an HTML table with election name heading
- [ ] 3.5 Add loading and error states to both pages

## 4. Dev Workflow and End-to-End Validation

- [ ] 4.1 Add root `dev` script that starts Hono server and Vite dev server concurrently
- [ ] 4.2 Add root `build` script that builds the Vite SPA
- [ ] 4.3 End-to-end validation: start dev, load SPA in browser, confirm election list loads from API, click an election, confirm results table renders with party names and vote totals
