import BallotList from "@/components/ballot-list";
import type { SectionDetail } from "@/lib/api/types.js";
import { buildProtocolLinks } from "@/lib/cik-links.js";
import { pct2 } from "../map/utils.js";

/**
 * Protocol summary + CIK links + party/candidate ballot list for the
 * selected section. Used by both `AnomalySidebarContent` (anomaly drilldown)
 * and `SimpleSidebarContent` (any other section).
 *
 * Falls back to a placeholder while the section detail is loading.
 */
export function SectionResults({
  data,
  loading,
  electionId,
  sectionCode,
  protocolUrl,
}: {
  data: SectionDetail | null;
  loading: boolean;
  electionId: string;
  sectionCode: string;
  protocolUrl?: string | null;
}) {
  if (loading) {
    return (
      <div className="text-xs text-muted-foreground">
        Зареждане на резултати...
      </div>
    );
  }
  if (!data) return null;

  const { protocol: p, parties } = data;
  const generated = buildProtocolLinks(sectionCode, parseInt(electionId));
  // Prefer the stored `sections.protocol_url` from the DB; fall back to the
  // URL we can construct from the election id + section code.
  const links = protocolUrl
    ? {
        protocol: protocolUrl,
        scan: protocolUrl
          .replace("#/p/", "#/s/")
          .replace("#/pk/", "#/s/")
          .replace(/\.html$/, ".pdf"),
        video: generated?.video ?? null,
      }
    : generated;

  return (
    <div className="rounded-lg border border-border p-3">
      <div className="mb-2 text-xs font-medium text-muted-foreground">
        Резултати от гласуването
      </div>

      <div className="mb-3 space-y-1 text-[11px]">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Регистрирани</span>
          <span className="font-mono font-medium tabular-nums">
            {p.registered_voters?.toLocaleString()}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Вписани допълнително</span>
          <span className="font-mono font-medium tabular-nums">
            {p.added_voters?.toLocaleString()}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Гласували</span>
          <span className="font-mono font-medium tabular-nums">
            {p.actual_voters?.toLocaleString()}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Активност</span>
          <span className="font-mono font-semibold tabular-nums">
            {p.registered_voters
              ? pct2((p.actual_voters / p.registered_voters) * 100)
              : "—"}
            %
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Валидни</span>
          <span className="font-mono font-medium tabular-nums text-green-700">
            {p.valid_votes?.toLocaleString()}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Невалидни</span>
          <span className="font-mono font-medium tabular-nums text-red-600">
            {(p.invalid_votes + (p.null_votes ?? 0))?.toLocaleString()}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Машинно гласуване</span>
          <span className="font-mono font-medium tabular-nums">
            {p.machine_count > 0 ? `Да (${p.machine_count})` : "Не"}
          </span>
        </div>
      </div>

      {links && (
        <div className="mb-3 flex flex-wrap gap-2 text-[11px]">
          <a
            href={links.protocol}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:underline"
          >
            Протокол
          </a>
          <a
            href={links.scan}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:underline"
          >
            Сканиран
          </a>
          {links.video && (
            <a
              href={links.video}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:underline"
            >
              Видео
            </a>
          )}
        </div>
      )}

      <BallotList entries={parties} variant="full-rows" />
    </div>
  );
}
