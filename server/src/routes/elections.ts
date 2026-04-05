import { Hono } from "hono";
import getDb from "../db.js";

const elections = new Hono();

elections.get("/", (c) => {
  const db = getDb();
  const rows = db
    .prepare("SELECT id, name, date, type FROM elections ORDER BY date DESC")
    .all();
  return c.json(rows);
});

elections.get("/:id/results", (c) => {
  const db = getDb();
  const { id } = c.req.param();

  const election = db
    .prepare("SELECT id, name, date, type FROM elections WHERE id = ?")
    .get(id);

  if (!election) {
    return c.json({ error: "Election not found" }, 404);
  }

  // Determine geographic filter — most specific wins
  const kmetstvo = c.req.query("kmetstvo");
  const localRegion = c.req.query("local_region");
  const municipality = c.req.query("municipality");
  const district = c.req.query("district");
  const rik = c.req.query("rik");

  let geoColumn: string | null = null;
  let geoValue: string | null = null;

  if (kmetstvo) {
    geoColumn = "l.kmetstvo_id";
    geoValue = kmetstvo;
  } else if (localRegion) {
    geoColumn = "l.local_region_id";
    geoValue = localRegion;
  } else if (municipality) {
    geoColumn = "l.municipality_id";
    geoValue = municipality;
  } else if (district) {
    geoColumn = "l.district_id";
    geoValue = district;
  } else if (rik) {
    geoColumn = "l.rik_id";
    geoValue = rik;
  }

  let sql: string;
  let params: unknown[];

  if (geoColumn && geoValue) {
    sql = `SELECT p.id AS party_id, COALESCE(ep.name_on_ballot, p.canonical_name) AS party_name, SUM(v.total) AS total_votes
       FROM votes v
       JOIN sections s ON s.election_id = v.election_id AND s.section_code = v.section_code
       JOIN locations l ON l.id = s.location_id
       JOIN election_parties ep ON ep.election_id = v.election_id AND ep.ballot_number = v.party_number
       JOIN parties p ON p.id = ep.party_id
       WHERE v.election_id = ? AND ${geoColumn} = ?
       GROUP BY p.id, party_name
       ORDER BY total_votes DESC`;
    params = [id, geoValue];
  } else {
    sql = `SELECT p.id AS party_id, COALESCE(ep.name_on_ballot, p.canonical_name) AS party_name, SUM(v.total) AS total_votes
       FROM votes v
       JOIN election_parties ep ON ep.election_id = v.election_id AND ep.ballot_number = v.party_number
       JOIN parties p ON p.id = ep.party_id
       WHERE v.election_id = ?
       GROUP BY p.id, party_name
       ORDER BY total_votes DESC`;
    params = [id];
  }

  const results = db.prepare(sql).all(...params);

  return c.json({ election, results });
});

export default elections;
