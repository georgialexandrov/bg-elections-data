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

elections.get("/compare", (c) => {
  const db = getDb();
  const electionsParam = c.req.query("elections");

  if (!electionsParam) {
    return c.json({ error: "Missing required 'elections' query parameter" }, 400);
  }

  const ids = electionsParam.split(",").map((s) => s.trim()).filter(Boolean);

  if (ids.length < 2) {
    return c.json({ error: "At least 2 elections are required" }, 400);
  }
  if (ids.length > 10) {
    return c.json({ error: "Maximum 10 elections allowed" }, 400);
  }

  const numericIds = ids.map(Number);
  if (numericIds.some(isNaN)) {
    return c.json({ error: "All election IDs must be numeric" }, 400);
  }

  // Verify all elections exist
  const placeholders = numericIds.map(() => "?").join(",");
  const existingElections = db
    .prepare(`SELECT id, name, date, type FROM elections WHERE id IN (${placeholders})`)
    .all(...numericIds) as { id: number; name: string; date: string; type: string }[];

  if (existingElections.length !== numericIds.length) {
    const foundIds = new Set(existingElections.map((e) => e.id));
    const missing = numericIds.find((id) => !foundIds.has(id));
    return c.json({ error: `Election with id ${missing} not found` }, 404);
  }

  // Geographic filter
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

  // Query per election to keep performance predictable (matches existing results endpoint)
  let geoSql: string;
  let makeParams: (elId: number) => unknown[];

  if (geoColumn && geoValue) {
    geoSql = `SELECT ? AS election_id, p.id AS party_id, p.canonical_name AS party_name, SUM(v.total) AS votes
       FROM votes v
       JOIN sections s ON s.election_id = v.election_id AND s.section_code = v.section_code
       JOIN locations l ON l.id = s.location_id
       JOIN election_parties ep ON ep.election_id = v.election_id AND ep.ballot_number = v.party_number
       JOIN parties p ON p.id = ep.party_id
       WHERE v.election_id = ? AND ${geoColumn} = ?
       GROUP BY p.id`;
    makeParams = (elId) => [elId, elId, geoValue];
  } else {
    geoSql = `SELECT ? AS election_id, p.id AS party_id, p.canonical_name AS party_name, SUM(v.total) AS votes
       FROM votes v
       JOIN election_parties ep ON ep.election_id = v.election_id AND ep.ballot_number = v.party_number
       JOIN parties p ON p.id = ep.party_id
       WHERE v.election_id = ?
       GROUP BY p.id`;
    makeParams = (elId) => [elId, elId];
  }

  const stmt = db.prepare(geoSql);
  const rows: { election_id: number; party_id: number; party_name: string; votes: number }[] = [];
  for (const elId of numericIds) {
    const elRows = stmt.all(...makeParams(elId)) as typeof rows;
    rows.push(...elRows);
  }

  // Compute totals per election for percentage calculation
  const totalsByElection = new Map<number, number>();
  for (const row of rows) {
    totalsByElection.set(
      row.election_id,
      (totalsByElection.get(row.election_id) || 0) + row.votes
    );
  }

  // Group by party
  const partyMap = new Map<number, { party_name: string; elections: Map<number, number>; totalVotes: number }>();
  for (const row of rows) {
    let entry = partyMap.get(row.party_id);
    if (!entry) {
      entry = { party_name: row.party_name, elections: new Map(), totalVotes: 0 };
      partyMap.set(row.party_id, entry);
    }
    entry.elections.set(row.election_id, row.votes);
    entry.totalVotes += row.votes;
  }

  // Build sorted entries
  const sortedEntries = Array.from(partyMap.entries())
    .sort((a, b) => b[1].totalVotes - a[1].totalVotes);

  // For each election, compute percentages using largest remainder method
  // to ensure they sum to exactly 100.0
  const percentages = new Map<number, Map<number, number>>(); // elId -> partyId -> pct
  for (const elId of numericIds) {
    const total = totalsByElection.get(elId) || 1;
    const exact = sortedEntries.map(([partyId, data]) => {
      const votes = data.elections.get(elId) || 0;
      return { partyId, exact: (votes / total) * 100 };
    });
    const floored = exact.map((e) => Math.floor(e.exact * 10) / 10);
    const remainders = exact.map((e, i) => ({
      index: i,
      remainder: Math.round((e.exact * 10 - Math.floor(e.exact * 10)) * 1e9) / 1e9,
    }));
    const currentSum = Math.round(floored.reduce((a, b) => a + b, 0) * 10);
    const target = 1000; // 100.0 * 10
    let toDistribute = target - currentSum;
    remainders.sort((a, b) => b.remainder - a.remainder);
    for (const r of remainders) {
      if (toDistribute <= 0) break;
      floored[r.index] = Math.round((floored[r.index] + 0.1) * 10) / 10;
      toDistribute--;
    }
    const elMap = new Map<number, number>();
    sortedEntries.forEach(([partyId], i) => {
      elMap.set(partyId, floored[i]);
    });
    percentages.set(elId, elMap);
  }

  const results = sortedEntries.map(([partyId, data]) => {
    const electionsObj: Record<string, { votes: number; percentage: number }> = {};
    for (const elId of numericIds) {
      const votes = data.elections.get(elId) || 0;
      const pct = percentages.get(elId)!.get(partyId) || 0;
      electionsObj[String(elId)] = { votes, percentage: pct };
    }
    return {
      party_id: partyId,
      party_name: data.party_name,
      elections: electionsObj,
    };
  });

  return c.json({ elections: existingElections, results });
});

const VALID_GROUP_BY = ["rik", "district", "municipality", "kmetstvo", "local_region"] as const;
type GroupByLevel = typeof VALID_GROUP_BY[number];

const GEO_TABLE_MAP: Record<GroupByLevel, { table: string; column: string }> = {
  rik: { table: "riks", column: "rik_id" },
  district: { table: "districts", column: "district_id" },
  municipality: { table: "municipalities", column: "municipality_id" },
  kmetstvo: { table: "kmetstva", column: "kmetstvo_id" },
  local_region: { table: "local_regions", column: "local_region_id" },
};

elections.get("/:id/turnout", (c) => {
  const db = getDb();
  const { id } = c.req.param();

  const election = db
    .prepare("SELECT id, name, date, type FROM elections WHERE id = ?")
    .get(id) as { id: number; name: string; date: string; type: string } | undefined;

  if (!election) {
    return c.json({ error: "Election not found" }, 404);
  }

  const groupBy = c.req.query("group_by") as string | undefined;

  if (!groupBy) {
    return c.json({ error: "Missing required 'group_by' query parameter" }, 400);
  }

  if (!VALID_GROUP_BY.includes(groupBy as GroupByLevel)) {
    return c.json({ error: `Invalid group_by value. Must be one of: ${VALID_GROUP_BY.join(", ")}` }, 400);
  }

  const geo = GEO_TABLE_MAP[groupBy as GroupByLevel];

  // Determine geographic filter — most specific wins
  const kmetstvo = c.req.query("kmetstvo");
  const localRegion = c.req.query("local_region");
  const municipality = c.req.query("municipality");
  const district = c.req.query("district");
  const rik = c.req.query("rik");

  let filterColumn: string | null = null;
  let filterValue: string | null = null;

  if (kmetstvo) {
    filterColumn = "l.kmetstvo_id";
    filterValue = kmetstvo;
  } else if (localRegion) {
    filterColumn = "l.local_region_id";
    filterValue = localRegion;
  } else if (municipality) {
    filterColumn = "l.municipality_id";
    filterValue = municipality;
  } else if (district) {
    filterColumn = "l.district_id";
    filterValue = district;
  } else if (rik) {
    filterColumn = "l.rik_id";
    filterValue = rik;
  }

  const filterClause = filterColumn && filterValue ? ` AND ${filterColumn} = ?` : "";
  const params: unknown[] = filterColumn && filterValue ? [id, filterValue] : [id];

  const sql = `SELECT g.id AS group_id, g.name AS group_name,
       SUM(COALESCE(p.registered_voters, 0)) AS registered_voters,
       SUM(COALESCE(p.actual_voters, 0)) AS actual_voters
FROM protocols p
JOIN sections s ON s.election_id = p.election_id AND s.section_code = p.section_code
JOIN locations l ON l.id = s.location_id
JOIN ${geo.table} g ON g.id = l.${geo.column}
WHERE p.election_id = ?${filterClause}
GROUP BY g.id, g.name
ORDER BY group_name`;

  const rows = db.prepare(sql).all(...params) as {
    group_id: number;
    group_name: string;
    registered_voters: number;
    actual_voters: number;
  }[];

  const turnout = rows.map((r) => ({
    ...r,
    turnout_pct: r.registered_voters > 0
      ? Math.round((r.actual_voters / r.registered_voters) * 10000) / 100
      : 0,
  }));

  const totalRegistered = rows.reduce((s, r) => s + r.registered_voters, 0);
  const totalActual = rows.reduce((s, r) => s + r.actual_voters, 0);

  return c.json({
    election,
    turnout,
    totals: {
      registered_voters: totalRegistered,
      actual_voters: totalActual,
      turnout_pct: totalRegistered > 0
        ? Math.round((totalActual / totalRegistered) * 10000) / 100
        : 0,
    },
  });
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
