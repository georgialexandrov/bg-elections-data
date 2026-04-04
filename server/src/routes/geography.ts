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

export default geography;
