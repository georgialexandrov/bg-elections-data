import { useState, type ReactNode } from "react";

/**
 * Tiny presentational primitives shared by every sidebar card.
 *
 * - `ScoreBar`: a coloured progress bar between 0 and 1. Green / orange /
 *   red bands at 0.3 and 0.6 — the same thresholds the API uses to flag
 *   sections. Designer can re-tune the bands here.
 * - `FormulaRow`: label-value row used inside the formula breakdown blocks.
 * - `MethodologyCard`: collapsible card wrapper used by every methodology
 *   section in the sidebar (Benford, peer, ACF). Title + score in the
 *   header, bar, expandable body.
 *
 * "Score" is the methodology-neutral word for "the value the model output";
 * we let the reader decide whether a high score means "risk".
 */

export function ScoreBar({
  value,
  className,
}: {
  value: number;
  className?: string;
}) {
  const color =
    value >= 0.6
      ? "bg-red-500"
      : value >= 0.3
        ? "bg-orange-400"
        : "bg-green-500";
  return (
    <div
      className={`h-1.5 w-full overflow-hidden rounded-full bg-muted ${className ?? ""}`}
    >
      <div
        className={`h-full rounded-full ${color}`}
        style={{ width: `${Math.min(value * 100, 100)}%` }}
      />
    </div>
  );
}

export function FormulaRow({
  label,
  value,
  unit,
}: {
  label: string;
  value: string | number;
  unit?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-[11px]">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono font-medium tabular-nums">
        {typeof value === "number" ? value.toFixed(2) : value}
        {unit && <span className="ml-0.5 text-muted-foreground">{unit}</span>}
      </span>
    </div>
  );
}

export function MethodologyCard({
  title,
  score,
  children,
  show = true,
}: {
  title: string;
  score: number;
  children: ReactNode;
  show?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  if (!show) return null;

  return (
    <div className="rounded-lg border border-border">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 p-3 text-left"
      >
        <div className="flex-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold">{title}</span>
            <span className="text-xs font-mono tabular-nums text-muted-foreground">
              {score.toFixed(2)}
            </span>
          </div>
          <ScoreBar value={score} className="mt-1.5" />
        </div>
        <span className="text-[10px] text-muted-foreground">
          {expanded ? "▲" : "▼"}
        </span>
      </button>
      {expanded && (
        <div className="border-t border-border px-3 pb-3 pt-2">{children}</div>
      )}
    </div>
  );
}
