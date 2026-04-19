import { MapPopup } from "@/components/ui/map";
import { Plus, Check } from "lucide-react";
import type { LiveAddress } from "@/lib/api/live-sections.js";
import type { LiveMetrics, LiveSectionMetric } from "@/lib/api/live-metrics.js";
import { cn } from "@/lib/utils";
import { LiveStatusBadge, type UiStatus } from "./live-status-badge.js";

/**
 * Map popup that opens when a marker is clicked. Lists every section at
 * this polling address with its live status and a one-click "watch"
 * button. The popup stays open while the user adds sections — they can
 * queue several cameras into the sidebar before dismissing it.
 *
 * Rendered inside MapLibre's popup, anchored to the address coordinate.
 * CloseButton is on so the user can dismiss without having to click
 * somewhere else on the map.
 */
export function LiveSectionPopup({
  address,
  metrics,
  streamBySection,
  watchCodes,
  canAddMore,
  onWatch,
  onClose,
}: {
  address: LiveAddress;
  metrics: LiveMetrics | undefined;
  streamBySection: Map<string, string>;
  watchCodes: string[];
  canAddMore: boolean;
  onWatch: (code: string) => void;
  onClose: () => void;
}) {
  const watching = new Set(watchCodes);

  return (
    <MapPopup
      longitude={address.lon}
      latitude={address.lat}
      onClose={onClose}
      closeButton
      closeOnClick={false}
      maxWidth="360px"
      className="!p-0"
    >
      <div className="min-w-[260px] max-w-[360px]">
        <header className="border-b border-border px-3 py-2">
          <p className="text-3xs font-medium uppercase tracking-eyebrow text-muted-foreground">
            РИК {String(address.rik).padStart(2, "0")} ·{" "}
            {address.section_codes.length}{" "}
            {address.section_codes.length === 1 ? "секция" : "секции"}
          </p>
          <h3 className="mt-0.5 truncate text-sm font-medium text-foreground" title={address.address}>
            {address.address}
          </h3>
        </header>

        <ul className="max-h-[40vh] overflow-y-auto divide-y divide-border/60">
          {address.section_codes.map((code) => {
            const status = resolveStatus(
              metrics?.[code],
              streamBySection.get(code),
            );
            const isWatching = watching.has(code);
            // "гледам" rows are read-only (already in the sidebar). Other
            // rows always fire onWatch: on desktop that appends a card, on
            // mobile (canAddMore=false) the parent replaces the single
            // open card — the label says "замени" to make that obvious.
            return (
              <li key={code}>
                <button
                  type="button"
                  onClick={() => {
                    if (!isWatching) onWatch(code);
                  }}
                  disabled={isWatching}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 px-3 py-2 text-left transition-colors",
                    isWatching
                      ? "cursor-default opacity-70"
                      : "hover:bg-secondary/60",
                  )}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="font-mono text-xs font-semibold tabular-nums text-foreground">
                      {code}
                    </span>
                    <LiveStatusBadge status={status} />
                  </div>
                  <span
                    className={cn(
                      "inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-2xs font-medium",
                      isWatching
                        ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                        : !canAddMore
                          ? "text-muted-foreground"
                          : "text-foreground hover:bg-secondary",
                    )}
                  >
                    {isWatching ? (
                      <>
                        <Check size={11} />
                        гледам
                      </>
                    ) : !canAddMore ? (
                      <>замени</>
                    ) : (
                      <>
                        <Plus size={11} />
                        гледай
                      </>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </MapPopup>
  );
}

function resolveStatus(
  metric: LiveSectionMetric | undefined,
  streamUrl: string | undefined,
): UiStatus {
  if (streamUrl && (!metric || metric.status === "ok")) return "live";
  if (!metric) return "no_camera";
  return metric.status;
}
