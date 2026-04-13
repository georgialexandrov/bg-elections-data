import type { Database as DatabaseType } from "better-sqlite3";

/** Lightweight queries for OG image data — no heavy joins, just what we need for the card. */

export interface OgElection {
  id: number;
  name: string;
  date: string;
  type: string;
  total_sections: number;
  flagged_sections: number;
}

export function getOgElection(
  db: DatabaseType,
  electionId: number,
): OgElection | null {
  return (
    (db
      .prepare(
        `SELECT e.id, e.name, e.date, e.type,
              (SELECT COUNT(*) FROM section_scores ss WHERE ss.election_id = e.id) AS total_sections,
              (SELECT COUNT(*) FROM section_scores ss WHERE ss.election_id = e.id AND ss.risk_score >= 0.3) AS flagged_sections
         FROM elections e WHERE e.id = ?`,
      )
      .get(electionId) as OgElection | undefined) ?? null
  );
}

export interface OgTopParty {
  name: string;
  color: string;
  votes: number;
  pct: number;
}

export function getOgTopParties(
  db: DatabaseType,
  electionId: number,
  limit = 5,
): OgTopParty[] {
  return db
    .prepare(
      `SELECT ep.name_on_ballot AS name,
              COALESCE(p.color, '#888888') AS color,
              SUM(v.total) AS votes,
              ROUND(100.0 * SUM(v.total) / NULLIF(
                (SELECT SUM(v2.total) FROM votes v2 WHERE v2.election_id = ?), 0
              ), 1) AS pct
         FROM votes v
         JOIN election_parties ep ON ep.election_id = v.election_id AND ep.ballot_number = v.party_number
         JOIN parties p ON p.id = ep.party_id
        WHERE v.election_id = ?
        GROUP BY v.party_number
        ORDER BY votes DESC
        LIMIT ?`,
    )
    .all(electionId, electionId, limit) as OgTopParty[];
}

export interface OgSectionDetail {
  section_code: string;
  settlement_name: string | null;
  address: string | null;
  elections_present: number;
  elections_flagged: number;
  avg_risk: number;
  max_risk: number;
  total_violations: number;
}

export function getOgSectionDetail(
  db: DatabaseType,
  sectionCode: string,
): OgSectionDetail | null {
  return (
    (db
      .prepare(
        `SELECT ss.section_code,
              l.settlement_name,
              COALESCE(s.address, l.address) AS address,
              COUNT(*) AS elections_present,
              SUM(CASE WHEN ss.risk_score >= 0.3 THEN 1 ELSE 0 END) AS elections_flagged,
              ROUND(AVG(ss.risk_score), 3) AS avg_risk,
              ROUND(MAX(ss.risk_score), 3) AS max_risk,
              SUM(ss.protocol_violation_count) AS total_violations
         FROM section_scores ss
         JOIN sections s ON s.election_id = ss.election_id AND s.section_code = ss.section_code
         JOIN locations l ON l.id = s.location_id
        WHERE ss.section_code = ?
        GROUP BY ss.section_code`,
      )
      .get(sectionCode) as OgSectionDetail | undefined) ?? null
  );
}

export interface OgSectionRiskHistory {
  election_name: string;
  risk_score: number;
}

export function getOgSectionRiskHistory(
  db: DatabaseType,
  sectionCode: string,
): OgSectionRiskHistory[] {
  return db
    .prepare(
      `SELECT e.name AS election_name, ss.risk_score
         FROM section_scores ss
         JOIN elections e ON e.id = ss.election_id
        WHERE ss.section_code = ?
        ORDER BY e.date`,
    )
    .all(sectionCode) as OgSectionRiskHistory[];
}

export interface OgDistrict {
  id: number;
  name: string;
  municipality_count: number;
  section_count: number;
}

export function getOgDistrict(
  db: DatabaseType,
  districtId: number,
): OgDistrict | null {
  return (
    (db
      .prepare(
        `SELECT d.id, d.name,
              (SELECT COUNT(DISTINCT l.municipality_id) FROM locations l WHERE l.district_id = d.id) AS municipality_count,
              (SELECT COUNT(DISTINCT s.section_code) FROM sections s JOIN locations l ON l.id = s.location_id WHERE l.district_id = d.id) AS section_count
         FROM districts d WHERE d.id = ?`,
      )
      .get(districtId) as OgDistrict | undefined) ?? null
  );
}

export interface OgPersistenceSummary {
  total_persistent: number;
  total_sections: number;
}

export function getOgPersistenceSummary(
  db: DatabaseType,
): OgPersistenceSummary {
  const row = db
    .prepare(
      `SELECT
        (SELECT COUNT(DISTINCT section_code) FROM section_scores) AS total_sections,
        (SELECT COUNT(*) FROM (
          SELECT section_code
          FROM section_scores
          GROUP BY section_code
          HAVING SUM(CASE WHEN risk_score >= 0.3 THEN 1 ELSE 0 END) >= 2
        )) AS total_persistent`,
    )
    .get() as OgPersistenceSummary;
  return row;
}
