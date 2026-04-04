import { describe, it, expect } from "vitest";
import app from "../app.js";

describe("GET /api/geography/riks", () => {
  it("returns 200 with a JSON array", async () => {
    const res = await app.request("/api/geography/riks");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
  });

  it("each entry has id and name", async () => {
    const res = await app.request("/api/geography/riks");
    const body = await res.json();
    const entry = body[0];
    expect(entry).toHaveProperty("id");
    expect(entry).toHaveProperty("name");
  });
});

describe("GET /api/geography/districts", () => {
  it("returns 200 with a JSON array", async () => {
    const res = await app.request("/api/geography/districts");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
  });

  it("each entry has id and name", async () => {
    const res = await app.request("/api/geography/districts");
    const body = await res.json();
    const entry = body[0];
    expect(entry).toHaveProperty("id");
    expect(entry).toHaveProperty("name");
  });
});

describe("GET /api/geography/municipalities", () => {
  it("returns all municipalities without filter", async () => {
    const res = await app.request("/api/geography/municipalities");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
  });

  it("filters by district when district param provided", async () => {
    const allRes = await app.request("/api/geography/municipalities");
    const all = await allRes.json();

    // Get the first district id from the districts endpoint
    const distRes = await app.request("/api/geography/districts");
    const districts = await distRes.json();
    const districtId = districts[0].id;

    const filteredRes = await app.request(
      `/api/geography/municipalities?district=${districtId}`
    );
    const filtered = await filteredRes.json();

    expect(Array.isArray(filtered)).toBe(true);
    expect(filtered.length).toBeGreaterThan(0);
    expect(filtered.length).toBeLessThanOrEqual(all.length);
  });

  it("each entry has id and name", async () => {
    const res = await app.request("/api/geography/municipalities");
    const body = await res.json();
    const entry = body[0];
    expect(entry).toHaveProperty("id");
    expect(entry).toHaveProperty("name");
  });
});

describe("GET /api/geography/kmetstva", () => {
  it("returns all kmetstva without filter", async () => {
    const res = await app.request("/api/geography/kmetstva");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it("filters by municipality when municipality param provided", async () => {
    const allRes = await app.request("/api/geography/kmetstva");
    const all = await allRes.json();

    if (all.length === 0) return; // skip if no kmetstva exist

    const muniRes = await app.request("/api/geography/municipalities");
    const municipalities = await muniRes.json();
    const municipalityId = municipalities[0].id;

    const filteredRes = await app.request(
      `/api/geography/kmetstva?municipality=${municipalityId}`
    );
    const filtered = await filteredRes.json();

    expect(Array.isArray(filtered)).toBe(true);
    expect(filtered.length).toBeLessThanOrEqual(all.length);
  });
});

describe("GET /api/geography/local-regions", () => {
  it("returns all local regions without filter", async () => {
    const res = await app.request("/api/geography/local-regions");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it("filters by municipality when municipality param provided", async () => {
    const allRes = await app.request("/api/geography/local-regions");
    const all = await allRes.json();

    if (all.length === 0) return; // skip if no local regions exist

    const muniRes = await app.request("/api/geography/municipalities");
    const municipalities = await muniRes.json();
    const municipalityId = municipalities[0].id;

    const filteredRes = await app.request(
      `/api/geography/local-regions?municipality=${municipalityId}`
    );
    const filtered = await filteredRes.json();

    expect(Array.isArray(filtered)).toBe(true);
    expect(filtered.length).toBeLessThanOrEqual(all.length);
  });
});
