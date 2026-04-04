import { describe, it, expect } from "vitest";
import app from "../app.js";

describe("GET /api/elections", () => {
  it("returns 200 with a JSON array of elections", async () => {
    const res = await app.request("/api/elections");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
  });

  it("each election has id, name, date, and type", async () => {
    const res = await app.request("/api/elections");
    const body = await res.json();
    const first = body[0];

    expect(first).toHaveProperty("id");
    expect(first).toHaveProperty("name");
    expect(first).toHaveProperty("date");
    expect(first).toHaveProperty("type");
  });
});

describe("GET /api/elections/:id/results", () => {
  it("Народно събрание 27.10.2024 (id=1) returns valid results", async () => {
    const res = await app.request("/api/elections/1/results");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty("election");
    expect(body).toHaveProperty("results");
    expect(body.election.id).toBe(1);
    expect(Array.isArray(body.results)).toBe(true);
  });

  it("Народно събрание 27.10.2024 КС (id=2) returns valid results", async () => {
    const res = await app.request("/api/elections/2/results");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty("election");
    expect(body).toHaveProperty("results");
    expect(body.election.id).toBe(2);
    expect(Array.isArray(body.results)).toBe(true);
  });

  it("Народно събрание 09.06.2024 (id=3) returns valid results", async () => {
    const res = await app.request("/api/elections/3/results");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty("election");
    expect(body).toHaveProperty("results");
    expect(body.election.id).toBe(3);
    expect(Array.isArray(body.results)).toBe(true);
  });

  it("Европейски парламент 09.06.2024 (id=4) returns valid results", async () => {
    const res = await app.request("/api/elections/4/results");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty("election");
    expect(body).toHaveProperty("results");
    expect(body.election.id).toBe(4);
    expect(Array.isArray(body.results)).toBe(true);
  });

  it("Общ.съветници 29.10.2023 (id=5) returns valid results", async () => {
    const res = await app.request("/api/elections/5/results");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty("election");
    expect(body).toHaveProperty("results");
    expect(body.election.id).toBe(5);
    expect(Array.isArray(body.results)).toBe(true);
  });

  it("Кмет 29.10.2023 (id=6) returns valid results", async () => {
    const res = await app.request("/api/elections/6/results");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty("election");
    expect(body).toHaveProperty("results");
    expect(body.election.id).toBe(6);
    expect(Array.isArray(body.results)).toBe(true);
  });

  it("Кмет кметство 29.10.2023 (id=7) returns valid results", async () => {
    const res = await app.request("/api/elections/7/results");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty("election");
    expect(body).toHaveProperty("results");
    expect(body.election.id).toBe(7);
    expect(Array.isArray(body.results)).toBe(true);
  });

  it("Кмет район 29.10.2023 (id=8) returns valid results", async () => {
    const res = await app.request("/api/elections/8/results");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty("election");
    expect(body).toHaveProperty("results");
    expect(body.election.id).toBe(8);
    expect(Array.isArray(body.results)).toBe(true);
  });

  it("Кмет 05.11.2023 (id=9) returns valid results", async () => {
    const res = await app.request("/api/elections/9/results");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty("election");
    expect(body).toHaveProperty("results");
    expect(body.election.id).toBe(9);
    expect(Array.isArray(body.results)).toBe(true);
  });

  it("Кмет кметство 05.11.2023 (id=10) returns valid results", async () => {
    const res = await app.request("/api/elections/10/results");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty("election");
    expect(body).toHaveProperty("results");
    expect(body.election.id).toBe(10);
    expect(Array.isArray(body.results)).toBe(true);
  });

  it("Кмет район 05.11.2023 (id=11) returns valid results", async () => {
    const res = await app.request("/api/elections/11/results");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty("election");
    expect(body).toHaveProperty("results");
    expect(body.election.id).toBe(11);
    expect(Array.isArray(body.results)).toBe(true);
  });

  it("Народно събрание 02.04.2023 (id=12) returns valid results", async () => {
    const res = await app.request("/api/elections/12/results");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty("election");
    expect(body).toHaveProperty("results");
    expect(body.election.id).toBe(12);
    expect(Array.isArray(body.results)).toBe(true);
  });

  it("Народно събрание 02.10.2022 (id=13) returns valid results", async () => {
    const res = await app.request("/api/elections/13/results");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty("election");
    expect(body).toHaveProperty("results");
    expect(body.election.id).toBe(13);
    expect(Array.isArray(body.results)).toBe(true);
  });

  it("Народно събрание 14.11.2021 (id=14) returns valid results", async () => {
    const res = await app.request("/api/elections/14/results");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty("election");
    expect(body).toHaveProperty("results");
    expect(body.election.id).toBe(14);
    expect(Array.isArray(body.results)).toBe(true);
  });

  it("Президент 14.11.2021 (id=15) returns valid results", async () => {
    const res = await app.request("/api/elections/15/results");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty("election");
    expect(body).toHaveProperty("results");
    expect(body.election.id).toBe(15);
    expect(Array.isArray(body.results)).toBe(true);
  });

  it("Президент 21.11.2021 (id=16) returns valid results", async () => {
    const res = await app.request("/api/elections/16/results");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty("election");
    expect(body).toHaveProperty("results");
    expect(body.election.id).toBe(16);
    expect(Array.isArray(body.results)).toBe(true);
  });

  it("Народно събрание 11.07.2021 (id=17) returns valid results", async () => {
    const res = await app.request("/api/elections/17/results");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty("election");
    expect(body).toHaveProperty("results");
    expect(body.election.id).toBe(17);
    expect(Array.isArray(body.results)).toBe(true);
  });

  it("Народно събрание 04.04.2021 (id=18) returns valid results", async () => {
    const res = await app.request("/api/elections/18/results");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty("election");
    expect(body).toHaveProperty("results");
    expect(body.election.id).toBe(18);
    expect(Array.isArray(body.results)).toBe(true);
  });

  it("result entries have valid party_id, party_name, and total_votes", async () => {
    const res = await app.request("/api/elections/1/results");
    const body = await res.json();

    expect(body.results.length).toBeGreaterThan(0);

    const result = body.results[0];
    expect(typeof result.party_id).toBe("number");
    expect(typeof result.party_name).toBe("string");
    expect(typeof result.total_votes).toBe("number");
    expect(result.total_votes).toBeGreaterThanOrEqual(0);
  });

  it("returns 404 for non-existent election", async () => {
    const res = await app.request("/api/elections/999999/results");
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body).toHaveProperty("error");
  });
});
