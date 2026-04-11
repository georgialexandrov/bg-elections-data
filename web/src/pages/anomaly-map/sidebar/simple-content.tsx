import type { SectionGeo } from "@/lib/api/types.js";
import { useAnomalies } from "@/lib/hooks/use-anomalies.js";
import { useSectionDetail } from "@/lib/hooks/use-sections.js";
import { SectionResults } from "./section-results.js";
import { AnomalySidebarContent } from "./index.js";

/**
 * Sidebar shown when the user clicks a section that wasn't in the current
 * anomaly overlay. Tries to fetch its anomaly row anyway (`min_risk: 0`,
 * `limit: 1`) — if the section has scores from the build pipeline, we
 * upgrade to the full anomaly sidebar; otherwise we show a basic
 * results-only view.
 */
export function SimpleSidebarContent({
  section,
  electionId,
}: {
  section: SectionGeo;
  electionId: string;
}) {
  const { data: anomalyData } = useAnomalies({
    electionId,
    minRisk: 0,
    limit: 1,
    section: section.section_code,
  });
  const anomaly = anomalyData?.sections?.[0] ?? null;

  // Hook order must be unconditional — call before any early return.
  const { data: sectionDetail, isLoading: detailLoading } = useSectionDetail(
    electionId,
    section.section_code,
  );

  if (anomaly) {
    return <AnomalySidebarContent section={anomaly} electionId={electionId} />;
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="text-lg font-bold">{section.section_code}</div>
        <div className="text-sm text-muted-foreground">
          {section.settlement_name}
        </div>
      </div>

      <SectionResults
        data={sectionDetail ?? null}
        loading={detailLoading}
        electionId={electionId}
        sectionCode={section.section_code}
      />
    </div>
  );
}
