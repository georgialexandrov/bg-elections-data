import { MapPopup } from "@/components/ui/map";
import type { LiveAddress } from "@/lib/api/live-sections.js";
import type { LiveMetrics } from "@/lib/api/live-metrics.js";
import { cn } from "@/lib/utils";

/**
 * Lightweight hover card anchored above a map marker. Doesn't steal
 * clicks — it's pure informational. The click popup (`LiveSectionPopup`)
 * does the picking.
 *
 * Summary shape:
 *   - any red sections → "X покрити · Y тъмни · Z замръзнали"
 *   - otherwise live/ok → "X камери работят"
 *   - no signal → "няма данни от камерите"
 */
export function LiveHoverTooltip({
  address,
  metrics,
  liveCodes,
}: {
  address: LiveAddress;
  metrics: LiveMetrics | undefined;
  liveCodes: Set<string>;
}) {
  const stats = summarize(address, metrics, liveCodes);

  return (
    <MapPopup
      longitude={address.lon}
      latitude={address.lat}
      closeButton={false}
      closeOnClick={false}
      offset={14}
      className="!p-0 pointer-events-none"
    >
      <div className="min-w-[220px] max-w-[320px] px-3 py-2">
        <p className="text-3xs font-medium uppercase tracking-eyebrow text-muted-foreground">
          РИК {String(address.rik).padStart(2, "0")} ·{" "}
          {address.section_codes.length}{" "}
          {address.section_codes.length === 1 ? "секция" : "секции"}
        </p>
        <p className="mt-0.5 truncate text-xs font-medium text-foreground" title={address.address}>
          {address.address}
        </p>
        <p
          className={cn(
            "mt-1.5 text-xs",
            stats.tone === "red"
              ? "text-score-high"
              : stats.tone === "green"
                ? "text-emerald-700 dark:text-emerald-400"
                : "text-muted-foreground",
          )}
        >
          {stats.text}
        </p>
      </div>
    </MapPopup>
  );
}

interface Summary {
  text: string;
  tone: "green" | "red" | "grey";
}

function summarize(
  address: LiveAddress,
  metrics: LiveMetrics | undefined,
  liveCodes: Set<string>,
): Summary {
  let covered = 0;
  let dark = 0;
  let frozen = 0;
  let live = 0;
  let ok = 0;
  let unknown = 0;

  for (const code of address.section_codes) {
    const m = metrics?.[code];
    const hasStream = liveCodes.has(code);
    if (m?.status === "covered") covered++;
    else if (m?.status === "dark") dark++;
    else if (m?.status === "frozen") frozen++;
    else if (hasStream) live++;
    else if (m?.status === "ok") ok++;
    else if (m?.status === "unknown") unknown++;
  }

  const redCount = covered + dark + frozen;
  if (redCount > 0) {
    const parts: string[] = [];
    if (covered) parts.push(`${covered} ${plural(covered, "покрита", "покрити")}`);
    if (dark) parts.push(`${dark} ${plural(dark, "тъмна", "тъмни")}`);
    if (frozen) parts.push(`${frozen} ${plural(frozen, "замръзнала", "замръзнали")}`);
    return { text: `Проблем · ${parts.join(" · ")}`, tone: "red" };
  }

  if (live || ok) {
    const working = live + ok;
    return {
      text:
        live > 0
          ? `${working} ${plural(working, "камера на живо", "камери на живо")}`
          : `${working} ${plural(working, "камера работи", "камери работят")}`,
      tone: "green",
    };
  }

  if (unknown > 0) {
    return { text: `${unknown} ${plural(unknown, "камера няма сигнал", "камери нямат сигнал")}`, tone: "grey" };
  }

  return { text: "Няма данни от камерите", tone: "grey" };
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}
