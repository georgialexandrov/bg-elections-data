import { useEffect, useState, type CSSProperties } from "react";
import type { LiveAddress } from "@/lib/api/live-sections.js";
import type { LiveMetrics } from "@/lib/api/live-metrics.js";
import { LiveVideoCard } from "./live-video-card.js";

const CARD_WIDTH_PX = 360;
const GAP_PX = 12;
const CARD_HEIGHT_ESTIMATE_PX = 420;
const VERTICAL_CHROME_PX = 120;

/**
 * Sidebar with one card per watched section. Width grows with the number
 * of cards — one card shows a 360 px column, not a 50 vw slab that leaves
 * the map squished. Columns only multiply when cards won't fit
 * vertically, and max out at half the viewport before the user starts
 * scrolling.
 */
export function LiveVideoPanel({
  watchCodes,
  addressBySectionCode,
  allAddresses,
  metrics,
  streamBySection,
  liveCodes,
  watchedAddressIds,
  onOpenPopup,
  onClose,
}: {
  watchCodes: string[];
  addressBySectionCode: Map<string, LiveAddress>;
  allAddresses: LiveAddress[];
  metrics: LiveMetrics | undefined;
  streamBySection: Map<string, string>;
  liveCodes: Set<string>;
  watchedAddressIds: string[];
  onOpenPopup: (addressId: string) => void;
  onClose: (code: string) => void;
}) {
  const { cardsPerCol, cols } = useGridShape(watchCodes.length);

  if (watchCodes.length === 0) return null;

  const desktopWidthPx = cols * CARD_WIDTH_PX + (cols - 1) * GAP_PX + 24;

  return (
    <aside
      className="flex w-full shrink-0 flex-col overflow-auto border-t border-border bg-background/95 p-3 backdrop-blur max-h-[60vh] md:h-full md:max-h-none md:max-w-[50vw] md:w-[var(--panel-width)] md:border-l md:border-t-0"
      style={
        {
          ["--panel-width" as string]: `${desktopWidthPx}px`,
          ["--panel-rows" as string]: String(cardsPerCol),
        } as CSSProperties
      }
    >
      <div className="grid gap-3 md:[grid-auto-flow:column] md:[grid-template-rows:repeat(var(--panel-rows),min-content)]">
        {watchCodes.map((code) => (
          <LiveVideoCard
            key={code}
            sectionCode={code}
            address={addressBySectionCode.get(code)}
            metric={metrics?.[code]}
            streamUrl={streamBySection.get(code)}
            metrics={metrics}
            streamBySection={streamBySection}
            allAddresses={allAddresses}
            liveCodes={liveCodes}
            watchedAddressIds={watchedAddressIds}
            onOpenPopup={onOpenPopup}
            onClose={() => onClose(code)}
          />
        ))}
      </div>
    </aside>
  );
}

function useGridShape(count: number): { cardsPerCol: number; cols: number } {
  const [shape, setShape] = useState(() => computeShape(count));
  useEffect(() => {
    setShape(computeShape(count));
  }, [count]);
  useEffect(() => {
    const onResize = () => setShape(computeShape(count));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [count]);
  return shape;
}

function computeShape(count: number): { cardsPerCol: number; cols: number } {
  if (typeof window === "undefined") return { cardsPerCol: 2, cols: 1 };
  const usableH = Math.max(
    CARD_HEIGHT_ESTIMATE_PX,
    window.innerHeight - VERTICAL_CHROME_PX,
  );
  const cardsPerCol = Math.max(1, Math.floor(usableH / CARD_HEIGHT_ESTIMATE_PX));
  const maxCols = Math.max(
    1,
    Math.floor((window.innerWidth * 0.5) / (CARD_WIDTH_PX + GAP_PX)),
  );
  const cols = Math.min(
    maxCols,
    Math.max(1, Math.ceil(Math.max(1, count) / cardsPerCol)),
  );
  return { cardsPerCol, cols };
}
