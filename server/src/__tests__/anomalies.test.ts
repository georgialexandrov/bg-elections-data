import { describe, it, expect } from "vitest";
import app from "../app.js";

describe("GET /api/elections/:id/anomalies", () => {
  it("returns sections sorted by risk_score desc by default", async () => {
    const res = await app.request("/api/elections/1/anomalies");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty("election");
    expect(body.election.id).toBe(1);
    expect(body).toHaveProperty("sections");
    expect(body).toHaveProperty("total");
    expect(body).toHaveProperty("limit");
    expect(body).toHaveProperty("offset");
    expect(Array.isArray(body.sections)).toBe(true);
    expect(body.sections.length).toBeGreaterThan(0);
    expect(body.sections.length).toBeLessThanOrEqual(50);

    // Verify descending order
    for (let i = 1; i < body.sections.length; i++) {
      expect(body.sections[i - 1].risk_score).toBeGreaterThanOrEqual(body.sections[i].risk_score);
    }
  });

  it("section entries have correct shape", async () => {
    const res = await app.request("/api/elections/1/anomalies?limit=1");
    const body = await res.json();
    const s = body.sections[0];

    expect(typeof s.section_code).toBe("string");
    expect(typeof s.risk_score).toBe("number");
    expect(typeof s.turnout_rate).toBe("number");
    expect(typeof s.turnout_zscore).toBe("number");
    expect(typeof s.benford_score).toBe("number");
    expect(typeof s.peer_vote_deviation).toBe("number");
    expect(s).toHaveProperty("arithmetic_error");
    expect(s).toHaveProperty("vote_sum_mismatch");
    expect(s).toHaveProperty("settlement_name");
    expect(s).toHaveProperty("lat");
    expect(s).toHaveProperty("lng");
  });

  it("min_risk filter excludes low-risk sections", async () => {
    const res = await app.request("/api/elections/1/anomalies?min_risk=0.5&limit=500");
    expect(res.status).toBe(200);
    const body = await res.json();

    for (const s of body.sections) {
      expect(s.risk_score).toBeGreaterThanOrEqual(0.5);
    }
  });

  it("min_risk=0 returns more sections than default", async () => {
    const [resDefault, resAll] = await Promise.all([
      app.request("/api/elections/1/anomalies"),
      app.request("/api/elections/1/anomalies?min_risk=0"),
    ]);
    const bodyDefault = await resDefault.json();
    const bodyAll = await resAll.json();

    expect(bodyAll.total).toBeGreaterThanOrEqual(bodyDefault.total);
  });

  it("sort by turnout_zscore asc works", async () => {
    const res = await app.request("/api/elections/1/anomalies?sort=turnout_zscore&order=asc&min_risk=0");
    expect(res.status).toBe(200);
    const body = await res.json();

    for (let i = 1; i < body.sections.length; i++) {
      expect(body.sections[i].turnout_zscore).toBeGreaterThanOrEqual(body.sections[i - 1].turnout_zscore);
    }
  });

  it("sort by section_code works", async () => {
    const res = await app.request("/api/elections/1/anomalies?sort=section_code&order=asc&min_risk=0&limit=10");
    expect(res.status).toBe(200);
    const body = await res.json();

    for (let i = 1; i < body.sections.length; i++) {
      expect(body.sections[i].section_code >= body.sections[i - 1].section_code).toBe(true);
    }
  });

  it("pagination with limit/offset returns correct slices", async () => {
    const res1 = await app.request("/api/elections/1/anomalies?limit=5&offset=0&min_risk=0");
    const res2 = await app.request("/api/elections/1/anomalies?limit=5&offset=5&min_risk=0");
    const body1 = await res1.json();
    const body2 = await res2.json();

    expect(body1.sections.length).toBe(5);
    expect(body2.sections.length).toBe(5);
    expect(body1.total).toBe(body2.total);
    // No overlap
    const codes1 = new Set(body1.sections.map((s: any) => s.section_code));
    for (const s of body2.sections) {
      expect(codes1.has(s.section_code)).toBe(false);
    }
  });

  it("returns 404 for non-existent election", async () => {
    const res = await app.request("/api/elections/999999/anomalies");
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toHaveProperty("error");
  });

  it("returns 400 for invalid sort column", async () => {
    const res = await app.request("/api/elections/1/anomalies?sort=invalid_column");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty("error");
  });

  it("geographic filter by district returns subset", async () => {
    const distRes = await app.request("/api/geography/districts");
    const districts = await distRes.json();
    const districtId = districts[0].id;

    const [nationalRes, filteredRes] = await Promise.all([
      app.request("/api/elections/1/anomalies?min_risk=0&limit=1"),
      app.request(`/api/elections/1/anomalies?min_risk=0&limit=1&district=${districtId}`),
    ]);
    const national = await nationalRes.json();
    const filtered = await filteredRes.json();

    expect(filtered.total).toBeLessThan(national.total);
    expect(filtered.total).toBeGreaterThan(0);
  });

  it("geographic filter by rik works", async () => {
    const riksRes = await app.request("/api/geography/riks");
    const riks = await riksRes.json();
    const rikId = riks[0].id;

    const res = await app.request(`/api/elections/1/anomalies?min_risk=0&rik=${rikId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBeGreaterThan(0);
  });
});
