import type { LiveSection } from "@/lib/api/live-sections.js";
import type {
  LiveMetrics,
  LiveSectionMetric,
  LiveStatus,
} from "@/lib/api/live-metrics.js";

/**
 * Simulation layer for the /live page. Activated by `?demo=1` in the URL
 * — replaces the real `/video/metrics` and `/video/sections` responses
 * with synthetic data so we can see every camera state (ok, covered, dark,
 * frozen, unknown) on the map and in the video cards before the real
 * stream goes live.
 *
 * Picks sections by seeded index steps, so the set is stable across
 * re-renders but still scattered across Bulgaria. Abroad is not sampled
 * because it was filtered out of the static section list.
 */

const SAMPLE_VIDEO_URL =
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4";

/** How many sections get each status in the demo. Tuned so reds are
 *  scattered enough to be obvious without drowning the map in alerts. */
const DISTRIBUTION: { status: LiveStatus; count: number; hasStream: boolean }[] = [
  { status: "ok", count: 180, hasStream: true }, // "live" cards
  { status: "ok", count: 120, hasStream: false }, // working cam, no stream yet
  { status: "covered", count: 45, hasStream: false },
  { status: "dark", count: 30, hasStream: false },
  { status: "frozen", count: 20, hasStream: false },
  { status: "unknown", count: 15, hasStream: false },
];

export interface DemoResult {
  metrics: LiveMetrics;
  streamBySection: Map<string, string>;
}

export function buildDemo(sections: LiveSection[]): DemoResult {
  const metrics: LiveMetrics = {};
  const streamBySection = new Map<string, string>();
  if (sections.length === 0) return { metrics, streamBySection };

  const total = DISTRIBUTION.reduce((n, d) => n + d.count, 0);
  // Evenly-spaced indices through the section list — spreads reds and
  // greens across the map instead of clumping them into one oblast.
  const picked = pickEvenly(sections, total);

  let cursor = 0;
  const now = Date.now();
  for (const { status, count, hasStream } of DISTRIBUTION) {
    for (let i = 0; i < count; i++) {
      const section = picked[cursor++];
      if (!section) break;
      const metric: LiveSectionMetric = {
        status,
        reported_at: now - Math.floor(Math.random() * 60_000),
      };
      if (status === "ok" && hasStream) {
        metric.luma = 90 + Math.random() * 40;
        metric.motion_diff = 2 + Math.random() * 5;
      } else if (status === "covered") {
        metric.cover_ratio = 0.6 + Math.random() * 0.35;
      } else if (status === "dark") {
        metric.luma = 5 + Math.random() * 15;
      } else if (status === "frozen") {
        metric.frozen_sec = 10 + Math.random() * 120;
      }
      metrics[section.section_code] = metric;
      if (hasStream) streamBySection.set(section.section_code, SAMPLE_VIDEO_URL);
    }
  }

  return { metrics, streamBySection };
}

function pickEvenly(sections: LiveSection[], n: number): LiveSection[] {
  if (n >= sections.length) return sections.slice();
  const step = sections.length / n;
  const out: LiveSection[] = [];
  for (let i = 0; i < n; i++) {
    const idx = Math.min(sections.length - 1, Math.floor(i * step));
    out.push(sections[idx]);
  }
  return out;
}
