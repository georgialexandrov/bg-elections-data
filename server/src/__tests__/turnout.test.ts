import { describe, it, expect } from "vitest";
import app from "../app.js";

describe("GET /api/elections/:id/turnout", () => {
  it("returns 400 when group_by is missing", async () => {
    const res = await app.request("/api/elections/1/turnout");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/group_by/);
  });

  it("returns 400 for invalid group_by value", async () => {
    const res = await app.request("/api/elections/1/turnout?group_by=invalid");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Invalid group_by/);
  });

  it("returns 404 for non-existent election", async () => {
    const res = await app.request(
      "/api/elections/999999/turnout?group_by=district"
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/not found/i);
  });

  it("returns valid turnout data grouped by district", async () => {
    const res = await app.request(
      "/api/elections/1/turnout?group_by=district"
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty("election");
    expect(body.election.id).toBe(1);
    expect(body).toHaveProperty("turnout");
    expect(Array.isArray(body.turnout)).toBe(true);
    expect(body.turnout.length).toBeGreaterThan(0);
    expect(body).toHaveProperty("totals");

    const entry = body.turnout[0];
    expect(typeof entry.group_id).toBe("number");
    expect(typeof entry.group_name).toBe("string");
    expect(typeof entry.registered_voters).toBe("number");
    expect(typeof entry.actual_voters).toBe("number");
    expect(typeof entry.turnout_pct).toBe("number");
    expect(entry.turnout_pct).toBeGreaterThan(0);
    expect(entry.turnout_pct).toBeLessThanOrEqual(100);
  });

  it("returns valid totals", async () => {
    const res = await app.request(
      "/api/elections/1/turnout?group_by=district"
    );
    const body = await res.json();

    expect(typeof body.totals.registered_voters).toBe("number");
    expect(typeof body.totals.actual_voters).toBe("number");
    expect(typeof body.totals.turnout_pct).toBe("number");
    expect(body.totals.registered_voters).toBeGreaterThan(0);
    expect(body.totals.actual_voters).toBeGreaterThan(0);
    expect(body.totals.turnout_pct).toBeGreaterThan(0);
  });

  it("supports grouping by municipality", async () => {
    const res = await app.request(
      "/api/elections/1/turnout?group_by=municipality"
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.turnout.length).toBeGreaterThan(0);
  });

  it("supports grouping by rik", async () => {
    const res = await app.request("/api/elections/1/turnout?group_by=rik");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.turnout.length).toBeGreaterThan(0);
  });

  it("geographic filtering returns a subset", async () => {
    // Get national totals
    const nationalRes = await app.request(
      "/api/elections/1/turnout?group_by=district"
    );
    const national = await nationalRes.json();

    // Get first district
    const distRes = await app.request("/api/geography/districts");
    const districts = await distRes.json();
    const districtId = districts[0].id;

    // Filter by that district, group by municipality
    const filteredRes = await app.request(
      `/api/elections/1/turnout?group_by=municipality&district=${districtId}`
    );
    expect(filteredRes.status).toBe(200);
    const filtered = await filteredRes.json();

    expect(filtered.totals.registered_voters).toBeLessThan(
      national.totals.registered_voters
    );
    expect(filtered.totals.registered_voters).toBeGreaterThan(0);
  });
});
