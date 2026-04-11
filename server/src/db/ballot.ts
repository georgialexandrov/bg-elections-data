/**
 * Ballot query helpers.
 *
 * Single source of truth for the "what shows on the ballot" display rule and
 * the votes→election_parties→parties join. Every endpoint that returns a list
 * of parties (or presidential candidate pairs) must route through this module
 * so the rule only lives in one place.
 *
 * The rule (in order of preference):
 *   1. `candidates.name`        — for mayor-type local elections, the candidate
 *                                  bound to (election, section.rik_code, ballot).
 *                                  Requires the section to be in scope, so the
 *                                  caller must opt in via `MAYOR_CANDIDATE_*`.
 *   2. `election_parties.name_on_ballot` — used for president rounds where the
 *                                  candidate pair is stored at election scope.
 *   3. `parties.canonical_name` / `parties.short_name` — party / committee fallback.
 *
 * Fragments use fixed aliases: `p` for parties, `ep` for election_parties,
 * `v` for votes, `s` for sections (where joined), `c` for candidates.
 * If a route query uses one of those for something else (e.g. protocols),
 * rename it locally before composing these fragments.
 */

import type { Database as DatabaseType } from "better-sqlite3";

// ---------- SQL fragments (inline into larger queries) ----------

/** Display name: candidate pair for presidents, party/committee name otherwise. */
export const BALLOT_NAME_SQL =
  "COALESCE(ep.name_on_ballot, p.canonical_name)";

/** Shorter display name for dense UI. */
export const BALLOT_SHORT_SQL =
  "COALESCE(ep.name_on_ballot, p.short_name, p.canonical_name)";

/** JOIN fragment that binds `v.party_number` → election_parties → parties. */
export const BALLOT_JOIN_SQL = `
  JOIN election_parties ep
    ON ep.election_id = v.election_id
   AND ep.ballot_number = v.party_number
  JOIN parties p ON p.id = ep.party_id
`;

/**
 * Election types where the ballot label should be the candidate name from the
 * candidates table, scoped by the section's rik_code (= municipality for the
 * main mayor, EKATTE for kmetstvo, neighbourhood code for neighbourhood; the
 * data pipeline normalises kmetstvo / neighbourhood candidates so all three
 * align with sections.rik_code).
 */
export const MAYOR_CANDIDATE_TYPES = [
  "local_mayor",
  "local_mayor_kmetstvo",
  "local_mayor_neighbourhood",
] as const;
export type MayorCandidateType = (typeof MAYOR_CANDIDATE_TYPES)[number];

export function isMayorCandidateType(type: string | null | undefined): boolean {
  return (
    !!type && (MAYOR_CANDIDATE_TYPES as readonly string[]).includes(type)
  );
}

/**
 * LEFT JOIN that resolves the per-section candidate for mayor-type elections.
 * The section's rik_code is fetched via a correlated subquery rather than a
 * sections JOIN — a few neighbourhood / kmetstvo sections appear multiple
 * times in `sections` (one row per administrative neighbourhood or settlement
 * the same physical station serves), so JOINing them would multiply vote rows.
 * Adds `c` (candidates) only.
 */
export const MAYOR_CANDIDATE_JOIN_SQL = `
  LEFT JOIN candidates c
    ON c.election_id = v.election_id
   AND c.party_number = v.party_number
   AND c.rik_code = (
         SELECT rik_code FROM sections
          WHERE election_id = v.election_id
            AND section_code = v.section_code
          LIMIT 1
       )
`;

/** Display name when the mayor-candidate join is active. */
export const MAYOR_BALLOT_NAME_SQL =
  "COALESCE(c.name, ep.name_on_ballot, p.canonical_name)";
export const MAYOR_BALLOT_SHORT_SQL =
  "COALESCE(c.name, ep.name_on_ballot, p.short_name, p.canonical_name)";

/** Standard column projection for a detailed per-section list. */
export const BALLOT_DETAIL_COLS = `
  p.id AS party_id,
  ${BALLOT_NAME_SQL} AS party_name,
  ${BALLOT_SHORT_SQL} AS party_short_name,
  p.color AS party_color
`;

/** Column projection that prefers the per-section candidate name. */
export const MAYOR_BALLOT_DETAIL_COLS = `
  p.id AS party_id,
  ${MAYOR_BALLOT_NAME_SQL} AS party_name,
  ${MAYOR_BALLOT_SHORT_SQL} AS party_short_name,
  p.color AS party_color
`;

// ---------- TypeScript row types ----------

export interface SectionBallotRow {
  party_id: number;
  party_name: string;
  party_short_name: string;
  party_color: string | null;
  votes: number;
  paper: number;
  machine: number;
}

export interface AggregatedBallotRow {
  party_id: number;
  party_name: string;
  party_color: string | null;
  votes: number;
}

/** Valid geo filter columns used by the results/compare endpoints. */
export type GeoColumn =
  | "l.kmetstvo_id"
  | "l.local_region_id"
  | "l.municipality_id"
  | "l.district_id"
  | "l.rik_id";

// ---------- High-level helpers ----------

/**
 * Full ballot list for a single section, sorted by votes DESC.
 * Used by the section-detail sidebar and per-section drill-downs.
 *
 * For mayor-type local elections (`local_mayor`, `local_mayor_kmetstvo`,
 * `local_mayor_neighbourhood`) the ballot label is the candidate name from
 * the candidates table — different municipalities have different candidates
 * sharing the same ballot number, so we resolve via the section's rik_code.
 */
export function getSectionBallot(
  db: DatabaseType,
  electionId: number | string,
  sectionCode: string,
  electionType?: string | null,
): SectionBallotRow[] {
  if (isMayorCandidateType(electionType)) {
    return db
      .prepare(
        `
        SELECT
          ${MAYOR_BALLOT_DETAIL_COLS},
          v.total AS votes,
          v.paper,
          v.machine
        FROM votes v
        ${BALLOT_JOIN_SQL}
        ${MAYOR_CANDIDATE_JOIN_SQL}
        WHERE v.election_id = ?
          AND v.section_code = ?
          AND v.total > 0
        ORDER BY v.total DESC
        `,
      )
      .all(electionId, sectionCode) as SectionBallotRow[];
  }

  return db
    .prepare(
      `
      SELECT
        ${BALLOT_DETAIL_COLS},
        v.total AS votes,
        v.paper,
        v.machine
      FROM votes v
      ${BALLOT_JOIN_SQL}
      WHERE v.election_id = ?
        AND v.section_code = ?
        AND v.total > 0
      ORDER BY v.total DESC
      `,
    )
    .all(electionId, sectionCode) as SectionBallotRow[];
}

/**
 * Aggregated ballot list for an entire election or a geo-filtered subset.
 * Returns one row per party, sorted by votes DESC.
 */
export function getAggregatedBallot(
  db: DatabaseType,
  electionId: number | string,
  opts: { geoColumn?: GeoColumn; geoValue?: string | number } = {},
): AggregatedBallotRow[] {
  const { geoColumn, geoValue } = opts;

  if (geoColumn && geoValue != null) {
    return db
      .prepare(
        `
        SELECT
          p.id AS party_id,
          ${BALLOT_NAME_SQL} AS party_name,
          p.color AS party_color,
          SUM(v.total) AS votes
        FROM votes v
        JOIN sections s ON s.election_id = v.election_id AND s.section_code = v.section_code
        JOIN locations l ON l.id = s.location_id
        ${BALLOT_JOIN_SQL}
        WHERE v.election_id = ? AND ${geoColumn} = ?
        GROUP BY p.id
        ORDER BY votes DESC
        `,
      )
      .all(electionId, geoValue) as AggregatedBallotRow[];
  }

  return db
    .prepare(
      `
      SELECT
        p.id AS party_id,
        ${BALLOT_NAME_SQL} AS party_name,
        p.color AS party_color,
        SUM(v.total) AS votes
      FROM votes v
      ${BALLOT_JOIN_SQL}
      WHERE v.election_id = ?
      GROUP BY p.id
      ORDER BY votes DESC
      `,
    )
    .all(electionId) as AggregatedBallotRow[];
}

/**
 * Resolve query params to a GeoColumn + value. Returns null if no geo filter.
 * Order matches existing route behavior: most specific wins.
 */
export function resolveGeoFilter(query: {
  kmetstvo?: string;
  local_region?: string;
  municipality?: string;
  district?: string;
  rik?: string;
}): { column: GeoColumn; value: string } | null {
  if (query.kmetstvo) return { column: "l.kmetstvo_id", value: query.kmetstvo };
  if (query.local_region) return { column: "l.local_region_id", value: query.local_region };
  if (query.municipality) return { column: "l.municipality_id", value: query.municipality };
  if (query.district) return { column: "l.district_id", value: query.district };
  if (query.rik) return { column: "l.rik_id", value: query.rik };
  return null;
}
