import { Hono } from "hono";
import getDb from "../db.js";

const geography = new Hono();

geography.get("/riks", (c) => {
  const db = getDb();
  const rows = db.prepare("SELECT id, name FROM riks ORDER BY id").all();
  return c.json(rows);
});

geography.get("/districts", (c) => {
  const db = getDb();
  const rows = db
    .prepare("SELECT id, name FROM districts ORDER BY id")
    .all();
  return c.json(rows);
});

geography.get("/municipalities", (c) => {
  const db = getDb();
  const district = c.req.query("district");
  if (district) {
    const rows = db
      .prepare(
        "SELECT id, name FROM municipalities WHERE district_id = ? ORDER BY id"
      )
      .all(district);
    return c.json(rows);
  }
  const rows = db
    .prepare("SELECT id, name FROM municipalities ORDER BY id")
    .all();
  return c.json(rows);
});

geography.get("/kmetstva", (c) => {
  const db = getDb();
  const municipality = c.req.query("municipality");
  if (municipality) {
    const rows = db
      .prepare(
        "SELECT id, name FROM kmetstva WHERE municipality_id = ? ORDER BY id"
      )
      .all(municipality);
    return c.json(rows);
  }
  const rows = db.prepare("SELECT id, name FROM kmetstva ORDER BY id").all();
  return c.json(rows);
});

geography.get("/local-regions", (c) => {
  const db = getDb();
  const municipality = c.req.query("municipality");
  if (municipality) {
    const rows = db
      .prepare(
        "SELECT id, name FROM local_regions WHERE municipality_id = ? ORDER BY id"
      )
      .all(municipality);
    return c.json(rows);
  }
  const rows = db
    .prepare("SELECT id, name FROM local_regions ORDER BY id")
    .all();
  return c.json(rows);
});

geography.get("/missing-coordinates", (c) => {
  const db = getDb();
  const page = parseInt(c.req.query("page") ?? "1");
  const limit = 50;
  const offset = (page - 1) * limit;
  const search = c.req.query("search") ?? "";

  let where = "WHERE l.lat IS NULL AND l.address IS NOT NULL AND l.address != ''";
  const params: unknown[] = [];
  if (search) {
    where += " AND (LOWER(l.settlement_name) LIKE ? OR LOWER(l.address) LIKE ? OR s.section_code LIKE ?)";
    const term = `%${search.toLowerCase()}%`;
    params.push(term, term, term);
  }

  const { total } = db.prepare(`
    SELECT COUNT(DISTINCT l.id) AS total
    FROM locations l
    JOIN sections s ON s.location_id = l.id
    ${where}
  `).get(...params) as { total: number };

  const rows = db.prepare(`
    SELECT
      l.id,
      l.settlement_name,
      l.address,
      l.ekatte,
      GROUP_CONCAT(DISTINCT s.section_code) AS section_codes,
      COUNT(DISTINCT s.section_code) AS section_count
    FROM locations l
    JOIN sections s ON s.location_id = l.id
    ${where}
    GROUP BY l.id
    ORDER BY section_count DESC, l.settlement_name
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  return c.json({ total, page, pages: Math.ceil(total / limit), locations: rows });
});

export default geography;
