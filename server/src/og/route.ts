import { Hono } from "hono";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import getDb from "../db.js";
import { renderOgImage } from "./render.js";
import {
  getOgElection,
  getOgTopParties,
  getOgSectionDetail,
  getOgSectionRiskHistory,
  getOgDistrict,
  getOgPersistenceSummary,
} from "./queries.js";
import {
  LandingTemplate,
  ElectionResultsTemplate,
  AnomalyTemplate,
  SectionDetailTemplate,
  PersistenceTemplate,
  DistrictTemplate,
} from "./templates.js";

const CACHE_DIR = resolve(import.meta.dirname, "../../../og-cache");
mkdirSync(CACHE_DIR, { recursive: true });

const og = new Hono();

function cachePath(key: string): string {
  return resolve(CACHE_DIR, `${key}.png`);
}

function fromCache(key: string): Buffer | null {
  const path = cachePath(key);
  if (existsSync(path)) return readFileSync(path);
  return null;
}

function toCache(key: string, data: Buffer): void {
  writeFileSync(cachePath(key), data);
}

async function servePng(
  key: string,
  generate: () => Promise<Buffer>,
): Promise<Response> {
  let png = fromCache(key);
  if (!png) {
    png = await generate();
    toCache(key, png);
  }
  return new Response(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=86400, s-maxage=604800",
    },
  });
}

// GET /og/landing.png
og.get("/landing.png", async () => {
  return servePng("landing", () => renderOgImage(LandingTemplate()));
});

// GET /og/election/:id/results.png
og.get("/election/:id/results.png", async (c) => {
  const db = getDb();
  const id = Number(c.req.param("id"));
  const election = getOgElection(db, id);
  if (!election) return c.text("Not found", 404);
  const parties = getOgTopParties(db, id);
  return servePng(`election-${id}-results`, () =>
    renderOgImage(ElectionResultsTemplate({ election, parties })),
  );
});

// GET /og/election/:id/sections.png
og.get("/election/:id/sections.png", async (c) => {
  const db = getDb();
  const id = Number(c.req.param("id"));
  const election = getOgElection(db, id);
  if (!election) return c.text("Not found", 404);
  return servePng(`election-${id}-sections`, () =>
    renderOgImage(AnomalyTemplate({ election, variant: "map" })),
  );
});

// GET /og/election/:id/table.png
og.get("/election/:id/table.png", async (c) => {
  const db = getDb();
  const id = Number(c.req.param("id"));
  const election = getOgElection(db, id);
  if (!election) return c.text("Not found", 404);
  return servePng(`election-${id}-table`, () =>
    renderOgImage(AnomalyTemplate({ election, variant: "table" })),
  );
});

// GET /og/section/:code.png
og.get("/section/:code.png", async (c) => {
  const db = getDb();
  const code = c.req.param("code");
  // Strip .png suffix if it got appended to the param
  const sectionCode = code.replace(/\.png$/, "");
  const section = getOgSectionDetail(db, sectionCode);
  if (!section) return c.text("Not found", 404);
  const history = getOgSectionRiskHistory(db, sectionCode);
  return servePng(`section-${sectionCode}`, () =>
    renderOgImage(SectionDetailTemplate({ section, history })),
  );
});

// GET /og/persistence.png
og.get("/persistence.png", async () => {
  const db = getDb();
  const summary = getOgPersistenceSummary(db);
  return servePng("persistence", () =>
    renderOgImage(PersistenceTemplate({ summary })),
  );
});

// GET /og/district/:id.png
og.get("/district/:id.png", async (c) => {
  const db = getDb();
  const id = Number(c.req.param("id"));
  const district = getOgDistrict(db, id);
  if (!district) return c.text("Not found", 404);
  return servePng(`district-${id}`, () =>
    renderOgImage(DistrictTemplate({ district })),
  );
});

export default og;
