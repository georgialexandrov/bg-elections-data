import type { Context, Next } from "hono";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import getDb from "../db.js";
import { getElection } from "../lib/get-election.js";
import { getOgSectionDetail } from "./queries.js";

const BOT_UA =
  /facebookexternalhit|Twitterbot|LinkedInBot|Slackbot|Discordbot|TelegramBot|WhatsApp|Viber|Googlebot|bingbot|yandex/i;

let indexHtml: string | null = null;

function getIndexHtml(): string {
  if (!indexHtml) {
    indexHtml = readFileSync(
      resolve(import.meta.dirname, "../../../web/dist/index.html"),
      "utf-8",
    );
  }
  return indexHtml;
}

const BASE_URL = process.env.BASE_URL || "https://karta.izborenmonitor.com";

interface OgMeta {
  title: string;
  description: string;
  image: string;
  url: string;
}

function resolveOgMeta(path: string): OgMeta | null {
  const db = getDb();

  // Landing
  if (path === "/" || path === "") {
    return {
      title: "Изборен монитор",
      description:
        "Резултати, аномалии и протоколи от изборите в България 2021–2025. Отворени данни за прозрачни избори.",
      image: `${BASE_URL}/og/landing.png`,
      url: BASE_URL,
    };
  }

  // Election results: /:id/results
  let match = path.match(/^\/(\d+)\/results\/?$/);
  if (match) {
    const election = getElection(db, Number(match[1]));
    if (!election) return null;
    return {
      title: `${election.name} — Резултати по райони`,
      description: `Карта на резултатите от ${election.name}. Пропорционално разпределение по райони.`,
      image: `${BASE_URL}/og/election/${election.id}/results.png`,
      url: `${BASE_URL}/${election.id}/results`,
    };
  }

  // Anomaly map: /:id/sections
  match = path.match(/^\/(\d+)\/sections\/?$/);
  if (match) {
    const election = getElection(db, Number(match[1]));
    if (!election) return null;
    return {
      title: `${election.name} — Карта на аномалиите`,
      description: `Секции с аномалии за ${election.name}. Бенфорд, ACF, отклонение от съседи, аритметични нарушения.`,
      image: `${BASE_URL}/og/election/${election.id}/sections.png`,
      url: `${BASE_URL}/${election.id}/sections`,
    };
  }

  // Sections table: /:id/table
  match = path.match(/^\/(\d+)\/table\/?$/);
  if (match) {
    const election = getElection(db, Number(match[1]));
    if (!election) return null;
    return {
      title: `${election.name} — Таблица на секциите`,
      description: `Подробна таблица на секциите за ${election.name}. Рискови показатели, явка, нарушения.`,
      image: `${BASE_URL}/og/election/${election.id}/table.png`,
      url: `${BASE_URL}/${election.id}/table`,
    };
  }

  // Section detail: /section/:code
  match = path.match(/^\/section\/(\d+)\/?$/);
  if (match) {
    const section = getOgSectionDetail(db, match[1]);
    if (!section) return null;
    const location = [section.settlement_name, section.address]
      .filter(Boolean)
      .join(", ");
    return {
      title: `Секция ${section.section_code}${location ? ` — ${location}` : ""}`,
      description: `${section.elections_flagged}/${section.elections_present} избора с аномалии. Макс. риск: ${section.max_risk.toFixed(2)}. ${section.total_violations} нарушения в протоколи.`,
      image: `${BASE_URL}/og/section/${section.section_code}.png`,
      url: `${BASE_URL}/section/${section.section_code}`,
    };
  }

  // Persistence
  if (path === "/persistence" || path === "/persistence/") {
    return {
      title: "Системни сигнали — Изборен монитор",
      description:
        "Секции с повтарящи се аномалии в множество избори. Кръстосан анализ 2021–2025.",
      image: `${BASE_URL}/og/persistence.png`,
      url: `${BASE_URL}/persistence`,
    };
  }

  // Browse district: /browse/district/:id
  match = path.match(/^\/browse\/district\/(\d+)\/?$/);
  if (match) {
    return {
      title: "Район — Изборен монитор",
      description: "Разгледай секциите в района.",
      image: `${BASE_URL}/og/district/${match[1]}.png`,
      url: `${BASE_URL}/browse/district/${match[1]}`,
    };
  }

  // Browse abroad
  if (path === "/browse/abroad" || path === "/browse/abroad/") {
    return {
      title: "Секции в чужбина — Изборен монитор",
      description:
        "Всички секции за гласуване в чужбина. Резултати и протоколи.",
      image: `${BASE_URL}/og/landing.png`,
      url: `${BASE_URL}/browse/abroad`,
    };
  }

  return null;
}

function injectMeta(html: string, meta: OgMeta): string {
  const tags = `
    <meta name="description" content="${esc(meta.description)}" />
    <meta property="og:type" content="website" />
    <meta property="og:title" content="${esc(meta.title)}" />
    <meta property="og:description" content="${esc(meta.description)}" />
    <meta property="og:image" content="${esc(meta.image)}" />
    <meta property="og:url" content="${esc(meta.url)}" />
    <meta property="og:site_name" content="Изборен монитор" />
    <meta property="og:locale" content="bg_BG" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${esc(meta.title)}" />
    <meta name="twitter:description" content="${esc(meta.description)}" />
    <meta name="twitter:image" content="${esc(meta.image)}" />
    <title>${esc(meta.title)}</title>`;

  // Replace existing <title> and inject before </head>
  let result = html.replace(/<title>[^<]*<\/title>/, "");
  result = result.replace("</head>", `${tags}\n</head>`);
  return result;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Hono middleware: for social media bot requests, inject OG meta tags
 * into the HTML response. For all other requests, pass through.
 */
export async function botMetaMiddleware(c: Context, next: Next) {
  const ua = c.req.header("User-Agent") || "";
  if (!BOT_UA.test(ua)) return next();

  // Only intercept HTML page requests, not API/assets
  const path = new URL(c.req.url).pathname;
  if (path.startsWith("/api/") || path.startsWith("/og/") || path.startsWith("/assets/")) {
    return next();
  }

  const meta = resolveOgMeta(path);
  if (!meta) return next();

  const html = injectMeta(getIndexHtml(), meta);
  return c.html(html);
}
