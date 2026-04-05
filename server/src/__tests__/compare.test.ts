import { describe, it, expect } from "vitest";
import app from "../app.js";

describe("GET /api/elections/compare", () => {
  it("returns 200 with valid comparison of 2 elections", async () => {
    const res = await app.request("/api/elections/compare?elections=1,17");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty("elections");
    expect(body).toHaveProperty("results");
    expect(Array.isArray(body.elections)).toBe(true);
    expect(body.elections).toHaveLength(2);
    expect(Array.isArray(body.results)).toBe(true);
    expect(body.results.length).toBeGreaterThan(0);
  });

  it("elections array contains metadata for each requested election", async () => {
    const res = await app.request("/api/elections/compare?elections=1,17");
    const body = await res.json();

    const ids = body.elections.map((e: any) => e.id);
    expect(ids).toContain(1);
    expect(ids).toContain(17);

    for (const election of body.elections) {
      expect(election).toHaveProperty("id");
      expect(election).toHaveProperty("name");
      expect(election).toHaveProperty("date");
      expect(election).toHaveProperty("type");
    }
  });

  it("result entries have party_id, party_name, and elections object", async () => {
    const res = await app.request("/api/elections/compare?elections=1,17");
    const body = await res.json();

    const result = body.results[0];
    expect(typeof result.party_id).toBe("number");
    expect(typeof result.party_name).toBe("string");
    expect(result).toHaveProperty("elections");
    expect(result.elections).toHaveProperty("1");
    expect(result.elections).toHaveProperty("17");
  });

  it("each election entry has votes (integer) and percentage (0-100)", async () => {
    const res = await app.request("/api/elections/compare?elections=1,17");
    const body = await res.json();

    for (const result of body.results) {
      for (const elId of ["1", "17"]) {
        const entry = result.elections[elId];
        expect(entry).toHaveProperty("votes");
        expect(entry).toHaveProperty("percentage");
        expect(typeof entry.votes).toBe("number");
        expect(typeof entry.percentage).toBe("number");
        expect(entry.percentage).toBeGreaterThanOrEqual(0);
        expect(entry.percentage).toBeLessThanOrEqual(100);
      }
    }
  });

  it("percentages sum to approximately 100 for each election", async () => {
    const res = await app.request("/api/elections/compare?elections=1,17");
    const body = await res.json();

    for (const elId of ["1", "17"]) {
      const sum = body.results.reduce(
        (acc: number, r: any) => acc + r.elections[elId].percentage,
        0
      );
      expect(sum).toBeGreaterThanOrEqual(99.9);
      expect(sum).toBeLessThanOrEqual(100.1);
    }
  });

  it("percentages are rounded to one decimal place", async () => {
    const res = await app.request("/api/elections/compare?elections=1,17");
    const body = await res.json();

    for (const result of body.results) {
      for (const elId of ["1", "17"]) {
        const pct = result.elections[elId].percentage;
        const rounded = Math.round(pct * 10) / 10;
        expect(pct).toBe(rounded);
      }
    }
  });

  it("parties appearing in only one election show votes: 0 for the other", async () => {
    const res = await app.request("/api/elections/compare?elections=1,17");
    const body = await res.json();

    // Find a party that has 0 votes in one election (likely exists given different party lists)
    const hasZero = body.results.some(
      (r: any) =>
        r.elections["1"].votes === 0 || r.elections["17"].votes === 0
    );
    expect(hasZero).toBe(true);
  });

  it("results are sorted by total votes descending", async () => {
    const res = await app.request("/api/elections/compare?elections=1,17");
    const body = await res.json();

    for (let i = 1; i < body.results.length; i++) {
      const prevTotal =
        body.results[i - 1].elections["1"].votes +
        body.results[i - 1].elections["17"].votes;
      const currTotal =
        body.results[i].elections["1"].votes +
        body.results[i].elections["17"].votes;
      expect(prevTotal).toBeGreaterThanOrEqual(currTotal);
    }
  });

  it("geographic filter scopes results to a district", async () => {
    // Get national results
    const nationalRes = await app.request(
      "/api/elections/compare?elections=1,17"
    );
    const national = await nationalRes.json();
    const nationalTotal = national.results.reduce(
      (sum: number, r: any) => sum + r.elections["1"].votes,
      0
    );

    // Get first district
    const distRes = await app.request("/api/geography/districts");
    const districts = await distRes.json();
    const districtId = districts[0].id;

    // Get filtered results
    const filteredRes = await app.request(
      `/api/elections/compare?elections=1,17&district=${districtId}`
    );
    expect(filteredRes.status).toBe(200);
    const filtered = await filteredRes.json();
    const filteredTotal = filtered.results.reduce(
      (sum: number, r: any) => sum + r.elections["1"].votes,
      0
    );

    expect(filteredTotal).toBeLessThan(nationalTotal);
    expect(filteredTotal).toBeGreaterThan(0);
  });

  it("returns 400 when fewer than 2 elections provided", async () => {
    const res = await app.request("/api/elections/compare?elections=1");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty("error");
  });

  it("returns 400 when more than 10 elections provided", async () => {
    const res = await app.request(
      "/api/elections/compare?elections=1,2,3,4,5,6,7,8,9,10,11"
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty("error");
  });

  it("returns 400 when elections parameter is missing", async () => {
    const res = await app.request("/api/elections/compare");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty("error");
  });

  it("returns 404 when a non-existent election ID is provided", async () => {
    const res = await app.request("/api/elections/compare?elections=1,9999");
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toHaveProperty("error");
  });

  it("uses canonical_name for party display across elections", async () => {
    const res = await app.request("/api/elections/compare?elections=1,17");
    const body = await res.json();

    // Each party_id should appear only once (grouped by canonical identity)
    const partyIds = body.results.map((r: any) => r.party_id);
    const uniqueIds = new Set(partyIds);
    expect(partyIds.length).toBe(uniqueIds.size);
  });
});
