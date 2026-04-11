import { useState } from "react";
import LocationCorrection from "@/components/location-correction.js";
import type { AnomalySection } from "@/lib/api/types.js";
import {
  useSectionDetail,
  useSectionViolations,
} from "@/lib/hooks/use-sections.js";
import { SECTION_TYPE_LABELS } from "../map/constants.js";
import { SectionResults } from "./section-results.js";
import { ViolationsSection } from "./violations-section.js";
import { OverallScoreCard } from "./cards/overall-score-card.js";
import { TurnoutCard } from "./cards/turnout-card.js";
import { BinaryFlags } from "./cards/binary-flags.js";
import { BenfordCard } from "./cards/benford-card.js";
import { PeerCard } from "./cards/peer-card.js";
import { AcfCard } from "./cards/acf-card.js";

/**
 * Composition root for the anomaly drill-down sidebar. Reads the per-section
 * detail and violations once and threads them into the individual cards.
 *
 * Each card is a separate file in `cards/`. To redesign one — say to swap
 * the ACF layout — open `cards/acf-card.tsx` and edit it without touching
 * anything else.
 *
 * Exported as `AnomalySidebarContent`.
 */
export function AnomalySidebarContent({
  section,
  electionId,
}: {
  section: AnomalySection;
  electionId: string;
}) {
  const [showCorrection, setShowCorrection] = useState(false);
  const s = section;

  const { data: sectionDetail, isLoading: detailLoading } = useSectionDetail(
    electionId,
    s.section_code,
  );
  const { data: violationsData } = useSectionViolations(
    electionId,
    s.section_code,
  );
  const violations = violationsData?.violations ?? [];
  const ctx = sectionDetail?.context ?? null;

  return (
    <div className="space-y-4">
      <SidebarHeader section={s} />

      <SectionResults
        data={sectionDetail ?? null}
        loading={detailLoading}
        electionId={electionId}
        sectionCode={s.section_code}
        protocolUrl={s.protocol_url}
      />

      <OverallScoreCard section={s} />
      <TurnoutCard section={s} ctx={ctx} />
      <BinaryFlags section={s} />

      <ViolationsSection violations={violations} />

      <BenfordCard section={s} parties={sectionDetail?.parties ?? null} />
      <PeerCard section={s} ctx={ctx} />
      <AcfCard section={s} ctx={ctx} />

      <button
        onClick={() => setShowCorrection(true)}
        className="w-full rounded-md border border-border px-3 py-2 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground"
      >
        Грешна локация
      </button>

      {showCorrection && (
        <LocationCorrection
          sectionCode={s.section_code}
          electionId={electionId}
          settlementName={s.settlement_name}
          address={s.address}
          currentLat={s.lat}
          currentLng={s.lng}
          onClose={() => setShowCorrection(false)}
        />
      )}
    </div>
  );
}

/**
 * Settlement name + section-type chip + address + CIK protocol link.
 * Header-only so the rest of the sidebar stays focused on data.
 */
function SidebarHeader({ section: s }: { section: AnomalySection }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <span>{s.settlement_name}</span>
        {SECTION_TYPE_LABELS[s.section_type] && (
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium">
            {SECTION_TYPE_LABELS[s.section_type]}
          </span>
        )}
      </div>
      {s.address && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span>{s.address}</span>
          <a
            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${s.address}, ${s.settlement_name}, Bulgaria`)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-shrink-0 text-blue-600 hover:underline"
            title="Виж в Google Maps"
          >
            🗺
          </a>
        </div>
      )}
      {s.protocol_url && (
        <a
          href={s.protocol_url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block mt-1 text-xs text-blue-600 hover:underline"
        >
          Протокол в ЦИК →
        </a>
      )}
    </div>
  );
}

