/**
 * Per-section sample tests.
 *
 * For every distinct election type in the DB, pick 10 deterministically
 * "random" sections (evenly distributed across the section_code space) and
 * hit `GET /api/elections/:id/sections/:code`. The point is to make sure
 * the per-section endpoint produces internally consistent output for every
 * election type — not just parliament.
 *
 * What we check, per section:
 *   - HTTP 200 + non-empty parties array
 *   - protocol fields are non-negative integers
 *   - actual_voters ≤ registered_voters + added_voters (turnout sanity)
 *   - protocol.valid_votes equals the sum of party votes (the route's own
 *     invariant — guards against future regressions on /:id/sections/:code)
 *   - every party row has paper + machine === total
 *   - every party row has a non-blank short_name
 *   - the API's per-section vote totals match what `votes` table reports
 *     directly (catches API/SQL transformation bugs)
 *
 * Selection is deterministic: we sort sections by code and walk in fixed
 * strides. Reproducible across runs, picks across the whole code range.
 */

import { describe, it, expect, beforeAll } from "vitest";
import app from "../app.js";
import getDb from "../db.js";

const SAMPLE_SIZE = 10;

interface ElectionRow {
  id: number;
  slug: string;
  name: string;
  type: string;
  date: string;
}

interface SamplePick {
  election: ElectionRow;
  sectionCode: string;
}

let typeBuckets: Record<string, SamplePick[]>;

function pickEvenly<T>(items: T[], n: number): T[] {
  if (items.length <= n) return items.slice();
  const out: T[] = [];
  const step = items.length / n;
  for (let i = 0; i < n; i++) {
    out.push(items[Math.floor(i * step)]);
  }
  return out;
}

beforeAll(() => {
  const db = getDb();

  // Pick the most recent election per type as the representative.
  const elections = db
    .prepare("SELECT id, slug, name, type, date FROM elections ORDER BY date DESC")
    .all() as ElectionRow[];

  const repByType = new Map<string, ElectionRow>();
  for (const e of elections) {
    if (!repByType.has(e.type)) repByType.set(e.type, e);
  }

  typeBuckets = {};
  for (const [type, election] of repByType) {
    const sectionRows = db
      .prepare(
        // Limit to sections that have at least one vote — kmetstvo & similar
        // can include polling stations whose protocol is empty for that
        // election (no candidate served that section).
        "SELECT DISTINCT section_code FROM votes WHERE election_id = ? ORDER BY section_code",
      )
      .all(election.id) as { section_code: string }[];

    const codes = sectionRows.map((r) => r.section_code);
    typeBuckets[type] = pickEvenly(codes, SAMPLE_SIZE).map((sectionCode) => ({
      election,
      sectionCode,
    }));
  }
});

describe("Per-section endpoint sanity (10 random sections per election type)", () => {
  // Build the case list lazily so each describe.each cell knows its label
  // before beforeAll runs. We seed it from a synchronous DB query here.
  const seedDb = getDb();
  const types = (
    seedDb.prepare("SELECT DISTINCT type FROM elections ORDER BY type").all() as {
      type: string;
    }[]
  ).map((r) => r.type);

  describe.each(types)("type=%s", (type) => {
    // Compute the 10 picks for this type *inside* the describe so each `it`
    // gets named with the actual section code (better failure messages).
    const picks: SamplePick[] = (() => {
      const db = getDb();
      const election = db
        .prepare(
          "SELECT id, slug, name, type, date FROM elections WHERE type = ? ORDER BY date DESC LIMIT 1",
        )
        .get(type) as ElectionRow;
      const codes = (
        db
          .prepare(
            "SELECT DISTINCT section_code FROM votes WHERE election_id = ? ORDER BY section_code",
          )
          .all(election.id) as { section_code: string }[]
      ).map((r) => r.section_code);
      return pickEvenly(codes, SAMPLE_SIZE).map((sectionCode) => ({
        election,
        sectionCode,
      }));
    })();

    it.each(picks.map((p) => [p.sectionCode, p]))(
      "section %s — endpoint is internally consistent",
      async (_label, pick) => {
        const { election, sectionCode } = pick as SamplePick;
        const res = await app.request(
          `/api/elections/${election.id}/sections/${sectionCode}`,
        );
        expect(res.status, `${election.slug}/${sectionCode}`).toBe(200);
        const body = (await res.json()) as {
          protocol: {
            registered_voters: number;
            actual_voters: number;
            received_ballots: number;
            added_voters: number;
            invalid_votes: number;
            null_votes: number;
            machine_count: number;
            valid_votes: number;
          };
          parties: {
            name: string;
            short_name: string;
            color: string | null;
            votes: number;
            paper: number;
            machine: number;
            pct: number;
          }[];
        };

        const { protocol, parties } = body;

        // Protocol fields are non-negative integers.
        for (const [field, value] of Object.entries(protocol)) {
          expect(Number.isInteger(value), `${sectionCode} ${field}=${value}`).toBe(true);
          expect(value, `${sectionCode} ${field}`).toBeGreaterThanOrEqual(0);
        }

        // Turnout sanity: actual ≤ registered + added.
        expect(
          protocol.actual_voters,
          `${sectionCode}: actual=${protocol.actual_voters} > registered+added=${protocol.registered_voters + protocol.added_voters}`,
        ).toBeLessThanOrEqual(protocol.registered_voters + protocol.added_voters);

        // Parties array must be non-empty (we sourced from `votes`, so there
        // must be at least one row).
        expect(parties.length, `${sectionCode}: parties`).toBeGreaterThan(0);

        // The route computes valid_votes as the sum of party votes — assert
        // the invariant so future regressions on /sections/:code surface.
        const partySum = parties.reduce((s, p) => s + p.votes, 0);
        expect(
          protocol.valid_votes,
          `${sectionCode}: valid_votes=${protocol.valid_votes} != sum(party votes)=${partySum}`,
        ).toBe(partySum);

        // Every party row: paper + machine = total, name fields populated.
        for (const p of parties) {
          expect(
            p.paper + p.machine,
            `${sectionCode} ${p.short_name}: paper=${p.paper} + machine=${p.machine} != total=${p.votes}`,
          ).toBe(p.votes);
          expect(p.short_name?.trim(), `${sectionCode}: blank short_name`).not.toBe("");
          expect(p.name?.trim(), `${sectionCode}: blank name`).not.toBe("");
        }

        // Cross-check: API party totals match what the votes table says
        // directly. Catches accidental filters or join changes.
        const directRows = getDb()
          .prepare(
            "SELECT party_number, total FROM votes WHERE election_id = ? AND section_code = ? ORDER BY party_number",
          )
          .all(election.id, sectionCode) as { party_number: number; total: number }[];
        const directSum = directRows.reduce((s, r) => s + r.total, 0);
        expect(
          partySum,
          `${sectionCode}: API party-sum=${partySum} != votes-table sum=${directSum}`,
        ).toBe(directSum);
      },
    );
  });
});
