/** OG image templates — one per page type.
 *
 * Satori uses flexbox-only layout with inline styles. No CSS classes,
 * no grid, no position:absolute. All elements are divs with `display: flex`.
 */

import type { ReactNode } from "react";
import type {
  OgElection,
  OgTopParty,
  OgSectionDetail,
  OgSectionRiskHistory,
  OgDistrict,
  OgPersistenceSummary,
  OgMunicipality,
} from "./queries.js";

// Brand — light theme
const RED = "#ce463c";
const BG = "#fbfbfb";
const TEXT = "#1a1a1a";
const MUTED = "#666666";
const STAT_BG = "#f0efed";
const BORDER = "#e5e3e0";

// Shared wrapper — white card with red accent line at top
function Card({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        backgroundColor: BG,
        padding: "0",
      }}
    >
      {/* Red top accent */}
      <div style={{ display: "flex", width: "100%", height: "6px", backgroundColor: RED }} />
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          padding: "48px 56px 40px",
        }}
      >
        {children}
      </div>
    </div>
  );
}

function Logo() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
      <div
        style={{
          display: "flex",
          width: "12px",
          height: "12px",
          backgroundColor: RED,
          borderRadius: "2px",
        }}
      />
      <span
        style={{
          fontFamily: "Geist",
          fontSize: "18px",
          color: MUTED,
          letterSpacing: "0.05em",
        }}
      >
        ИЗБОРЕН МОНИТОР
      </span>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "4px",
        padding: "16px 24px",
        backgroundColor: STAT_BG,
        borderRadius: "8px",
        border: `1px solid ${BORDER}`,
      }}
    >
      <span style={{ fontFamily: "Geist", fontSize: "14px", color: MUTED }}>
        {label}
      </span>
      <span
        style={{ fontFamily: "Geist", fontSize: "32px", fontWeight: 700, color: TEXT }}
      >
        {String(value)}
      </span>
    </div>
  );
}

// ─── Landing page ───

export function LandingTemplate() {
  return (
    <Card>
      <Logo />
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          justifyContent: "center",
          gap: "16px",
        }}
      >
        <span
          style={{
            fontFamily: "EB Garamond",
            fontSize: "64px",
            fontWeight: 700,
            color: TEXT,
            lineHeight: "1.1",
          }}
        >
          Виж как гласува
        </span>
        <span
          style={{
            fontFamily: "EB Garamond",
            fontSize: "64px",
            fontWeight: 700,
            color: RED,
            lineHeight: "1.1",
          }}
        >
          твоята секция
        </span>
        <span
          style={{
            fontFamily: "Geist",
            fontSize: "22px",
            color: MUTED,
            marginTop: "12px",
          }}
        >
          Резултати, аномалии и протоколи от изборите в България 2021–2025
        </span>
      </div>
    </Card>
  );
}

// ─── Election results (district pie map) ───

export function ElectionResultsTemplate({
  election,
  parties,
}: {
  election: OgElection;
  parties: OgTopParty[];
}) {
  return (
    <Card>
      <Logo />
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          justifyContent: "center",
          gap: "24px",
        }}
      >
        <span
          style={{
            fontFamily: "Geist",
            fontSize: "18px",
            color: MUTED,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
          }}
        >
          Резултати по райони
        </span>
        <span
          style={{
            fontFamily: "EB Garamond",
            fontSize: "52px",
            fontWeight: 700,
            color: TEXT,
            lineHeight: "1.1",
          }}
        >
          {election.name}
        </span>
        {/* Party bars */}
        <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "8px" }}>
          {parties.slice(0, 5).map((p) => (
            <div key={p.name} style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <div
                style={{
                  display: "flex",
                  width: `${Math.max(40, (p.pct / (parties[0]?.pct || 1)) * 400)}px`,
                  height: "28px",
                  backgroundColor: p.color,
                  borderRadius: "4px",
                }}
              />
              <span style={{ fontFamily: "Geist", fontSize: "16px", color: TEXT }}>
                {p.name}
              </span>
              <span style={{ fontFamily: "Geist", fontSize: "16px", color: MUTED }}>
                {p.pct}%
              </span>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

// ─── Anomaly map / sections table ───

export function AnomalyTemplate({
  election,
  variant,
}: {
  election: OgElection;
  variant: "map" | "table";
}) {
  const subtitle = variant === "map" ? "Карта на аномалиите" : "Таблица на секциите";
  return (
    <Card>
      <Logo />
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          justifyContent: "center",
          gap: "24px",
        }}
      >
        <span
          style={{
            fontFamily: "Geist",
            fontSize: "18px",
            color: MUTED,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
          }}
        >
          {subtitle}
        </span>
        <span
          style={{
            fontFamily: "EB Garamond",
            fontSize: "52px",
            fontWeight: 700,
            color: TEXT,
            lineHeight: "1.1",
          }}
        >
          {election.name}
        </span>
        <div style={{ display: "flex", gap: "16px", marginTop: "8px" }}>
          <Stat label="Секции" value={election.total_sections.toLocaleString("bg-BG")} />
          <Stat label="С аномалии" value={election.flagged_sections.toLocaleString("bg-BG")} />
          <Stat
            label="Процент"
            value={
              election.total_sections > 0
                ? `${((election.flagged_sections / election.total_sections) * 100).toFixed(1)}%`
                : "—"
            }
          />
        </div>
      </div>
    </Card>
  );
}

// ─── Section detail ───

export function SectionDetailTemplate({
  section,
  history,
}: {
  section: OgSectionDetail;
  history: OgSectionRiskHistory[];
}) {
  return (
    <Card>
      <Logo />
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          justifyContent: "center",
          gap: "20px",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <span
            style={{
              fontFamily: "Geist",
              fontSize: "18px",
              color: MUTED,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
            }}
          >
            Секция
          </span>
          <span
            style={{
              fontFamily: "EB Garamond",
              fontSize: "56px",
              fontWeight: 700,
              color: TEXT,
              lineHeight: "1.1",
            }}
          >
            {section.section_code}
          </span>
          {section.settlement_name && (
            <span style={{ fontFamily: "Geist", fontSize: "22px", color: MUTED }}>
              {section.settlement_name}
              {section.address ? ` — ${section.address}` : ""}
            </span>
          )}
        </div>

        <div style={{ display: "flex", gap: "16px" }}>
          <Stat
            label="Участвала в избори"
            value={section.elections_present}
          />
          <Stat
            label="С аномалии"
            value={`${section.elections_flagged}/${section.elections_present}`}
          />
          <Stat label="Макс. риск" value={section.max_risk.toFixed(2)} />
          <Stat label="Нарушения" value={section.total_violations} />
        </div>

        {/* Mini risk sparkline as bars */}
        {history.length > 0 && (
          <div style={{ display: "flex", alignItems: "flex-end", gap: "4px", height: "60px", marginTop: "8px" }}>
            {history.map((h, i) => {
              const barH = Math.max(4, h.risk_score * 56);
              const color = h.risk_score >= 0.6 ? RED : h.risk_score >= 0.3 ? "#e8a838" : "#4ade80";
              return (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    width: `${Math.min(40, Math.floor(700 / history.length))}px`,
                    height: `${barH}px`,
                    backgroundColor: color,
                    borderRadius: "3px 3px 0 0",
                  }}
                />
              );
            })}
          </div>
        )}
      </div>
    </Card>
  );
}

// ─── Persistence ───

export function PersistenceTemplate({
  summary,
}: {
  summary: OgPersistenceSummary;
}) {
  return (
    <Card>
      <Logo />
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          justifyContent: "center",
          gap: "24px",
        }}
      >
        <span
          style={{
            fontFamily: "Geist",
            fontSize: "18px",
            color: MUTED,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
          }}
        >
          Системни сигнали
        </span>
        <span
          style={{
            fontFamily: "EB Garamond",
            fontSize: "52px",
            fontWeight: 700,
            color: TEXT,
            lineHeight: "1.1",
          }}
        >
          Повтарящи се аномалии
        </span>
        <span style={{ fontFamily: "Geist", fontSize: "22px", color: MUTED }}>
          Секции с аномалии в поне 2 избора
        </span>
        <div style={{ display: "flex", gap: "16px", marginTop: "8px" }}>
          <Stat label="Общо секции" value={summary.total_sections.toLocaleString("bg-BG")} />
          <Stat label="Системни" value={summary.total_persistent.toLocaleString("bg-BG")} />
        </div>
      </div>
    </Card>
  );
}

// ─── Contextual results (municipality selected) ───

export function ResultsContextTemplate({
  election,
  municipality,
  parties,
  highlightParty,
  mapDataUri,
}: {
  election: OgElection;
  municipality: OgMunicipality | null;
  parties: OgTopParty[];
  highlightParty?: string | null;
  mapDataUri?: string | null;
}) {
  const scope = municipality ? municipality.name : "Национални резултати";
  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Logo />
        <span
          style={{
            fontFamily: "Geist",
            fontSize: "16px",
            color: MUTED,
          }}
        >
          karta.izborenmonitor.com
        </span>
      </div>
      <div
        style={{
          display: "flex",
          flex: 1,
          gap: "32px",
          alignItems: "center",
        }}
      >
        {/* Left: map */}
        {mapDataUri && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: "480px",
              flexShrink: 0,
            }}
          >
            <img
              src={mapDataUri}
              width={460}
              height={280}
              style={{ objectFit: "contain" }}
            />
          </div>
        )}
        {/* Right: text + bars */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            justifyContent: "center",
            gap: "16px",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <span
              style={{
                fontFamily: "Geist",
                fontSize: "16px",
                color: MUTED,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
              }}
            >
              {scope}
            </span>
            <span
              style={{
                fontFamily: "EB Garamond",
                fontSize: "36px",
                fontWeight: 700,
                color: TEXT,
                lineHeight: "1.15",
              }}
            >
              {election.name}
            </span>
          </div>
          {/* Party bars — scale to the largest entry (often non-voters) */}
          <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
            {parties.map((p) => {
              const isHighlighted = highlightParty && p.name.toLowerCase() === highlightParty.toLowerCase();
              const maxPct = Math.max(...parties.map((pp) => pp.pct), 1);
              const maxBar = mapDataUri ? 220 : 360;
              const barWidth = Math.max(24, (p.pct / maxPct) * maxBar);
              return (
                <div
                  key={p.name}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    opacity: highlightParty && !isHighlighted ? 0.2 : 1,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      width: `${barWidth}px`,
                      height: "22px",
                      backgroundColor: p.color,
                      borderRadius: "3px",
                    }}
                  />
                  <span
                    style={{
                      fontFamily: "Geist",
                      fontSize: "13px",
                      fontWeight: isHighlighted ? 700 : 400,
                      color: TEXT,
                    }}
                  >
                    {p.name}
                  </span>
                  <span style={{ fontFamily: "Geist", fontSize: "13px", color: MUTED }}>
                    {p.pct}%
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </Card>
  );
}

// ─── Browse district ───

export function DistrictTemplate({ district }: { district: OgDistrict }) {
  return (
    <Card>
      <Logo />
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          justifyContent: "center",
          gap: "24px",
        }}
      >
        <span
          style={{
            fontFamily: "Geist",
            fontSize: "18px",
            color: MUTED,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
          }}
        >
          Район
        </span>
        <span
          style={{
            fontFamily: "EB Garamond",
            fontSize: "56px",
            fontWeight: 700,
            color: TEXT,
            lineHeight: "1.1",
          }}
        >
          {district.name}
        </span>
        <div style={{ display: "flex", gap: "16px", marginTop: "8px" }}>
          <Stat label="Общини" value={district.municipality_count} />
          <Stat label="Секции" value={district.section_count.toLocaleString("bg-BG")} />
        </div>
      </div>
    </Card>
  );
}
