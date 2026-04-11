/**
 * Bottom-left legend mapping marker size + colour to the score thresholds.
 * Shown only when the anomaly overlay is active. Pure presentation.
 *
 * Keep the four entries below in sync with the colour bands inside
 * `map/anomaly-circles-layer.tsx`.
 */
const LEGEND_ENTRIES = [
  { size: "h-2.5 w-2.5", color: "bg-yellow-400", label: "0.3 — Нисък" },
  { size: "h-3 w-3", color: "bg-orange-500", label: "0.5 — Среден" },
  { size: "h-3.5 w-3.5", color: "bg-red-500", label: "0.7 — Висок" },
  { size: "h-4 w-4", color: "bg-red-900", label: "1.0 — Критичен" },
];

export function AnomalyLegend() {
  return (
    <div className="absolute bottom-2 left-2 z-10 rounded-lg border border-border bg-background/94 p-2 text-[11px] shadow-md backdrop-blur-sm md:bottom-4 md:left-3 md:p-3">
      <div className="mb-1.5 font-semibold text-muted-foreground">
        Ниво на риск
      </div>
      {LEGEND_ENTRIES.map((item) => (
        <div key={item.label} className="mb-0.5 flex items-center gap-1.5">
          <span className={`inline-block rounded-full ${item.size} ${item.color}`} />
          <span className="text-muted-foreground">{item.label}</span>
        </div>
      ))}
    </div>
  );
}
