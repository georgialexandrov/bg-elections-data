import { useMemo } from "react";
import type { LiveAddress } from "@/lib/api/live-sections.js";
import type { LiveMetrics } from "@/lib/api/live-metrics.js";
import { cn } from "@/lib/utils";
import { addressTone } from "./live-map.js";
import { findNearbyAddresses } from "./nearby.js";

/**
 * "Other polling places down the street" — a small chip row inside each
 * card. Clicking a chip opens the section-picker popup for that address
 * on the map so the viewer can decide which camera to add.
 *
 * `streamBySection` is kept in the props (unused here today) because the
 * downstream tone calculation will start differentiating "has a stream"
 * from "has ok metrics" once the real camera feed goes live.
 */
export function LiveNearbyChips({
  target,
  allAddresses,
  metrics,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  streamBySection,
  liveCodes,
  watchedAddressIds,
  onOpenPopup,
}: {
  target: LiveAddress;
  allAddresses: LiveAddress[];
  metrics: LiveMetrics | undefined;
  streamBySection: Map<string, string>;
  liveCodes: Set<string>;
  watchedAddressIds: string[];
  onOpenPopup: (addressId: string) => void;
}) {
  const nearby = useMemo(
    () => findNearbyAddresses(target, allAddresses),
    [target, allAddresses],
  );

  if (nearby.length === 0) return null;

  const watchedSet = new Set(watchedAddressIds);

  return (
    <div className="flex flex-col gap-1 border-t border-border px-3 py-2">
      <span className="text-3xs font-medium uppercase tracking-eyebrow text-muted-foreground">
        Наблизо
      </span>
      <div className="flex flex-wrap gap-1">
        {nearby.map((a) => (
          <NearbyChip
            key={a.id}
            address={a}
            tone={addressTone(a, metrics, liveCodes)}
            watched={watchedSet.has(a.id)}
            onClick={() => onOpenPopup(a.id)}
          />
        ))}
      </div>
    </div>
  );
}

function NearbyChip({
  address,
  tone,
  watched,
  onClick,
}: {
  address: LiveAddress;
  tone: "green" | "red" | "grey";
  watched: boolean;
  onClick: () => void;
}) {
  const dotClass =
    tone === "green"
      ? "bg-emerald-500"
      : tone === "red"
        ? "bg-score-high"
        : "bg-muted-foreground/50";

  return (
    <button
      type="button"
      onClick={onClick}
      title={address.address}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-3xs tabular-nums transition-colors",
        watched
          ? "border-emerald-500/40 bg-emerald-500/5 text-foreground"
          : "border-border bg-background text-foreground hover:bg-secondary",
      )}
    >
      <span className={cn("size-1.5 rounded-full", dotClass)} />
      {address.section_codes[0]}
      {address.section_codes.length > 1 && (
        <span className="text-3xs text-muted-foreground">
          +{address.section_codes.length - 1}
        </span>
      )}
    </button>
  );
}
