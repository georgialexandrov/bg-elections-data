import { useEffect, useState, useCallback } from "react";
import { useParams, Link } from "react-router";
import LocationFilter from "../components/location-filter.js";
import { Map, MapMarker, MarkerContent, MarkerPopup } from "@/components/ui/map";

interface Election {
  id: number;
  name: string;
  date: string;
  type: string;
}

interface ScoredSection {
  section_code: string;
  settlement_name: string;
  lat: number | null;
  lng: number | null;
  risk_score: number;
  turnout_rate: number;
  turnout_zscore: number;
  benford_score: number;
  peer_vote_deviation: number;
  arithmetic_error: number;
  vote_sum_mismatch: number;
  protocol_violation_count: number;
}

interface AnomaliesResponse {
  election: Election;
  sections: ScoredSection[];
  total: number;
  limit: number;
  offset: number;
}

interface Violation {
  rule_id: string;
  description: string;
  expected_value: string;
  actual_value: string;
  severity: string;
}

type SortColumn =
  | "risk_score"
  | "turnout_rate"
  | "turnout_zscore"
  | "benford_score"
  | "peer_vote_deviation"
  | "arithmetic_error"
  | "vote_sum_mismatch"
  | "protocol_violation_count"
  | "section_code"
  | "settlement_name";

type Methodology = "combined" | "benford" | "peer" | "acf" | "protocol";

const METHODOLOGY_LABELS: { key: Methodology; label: string }[] = [
  { key: "combined", label: "Комбиниран" },
  { key: "benford", label: "Бенфорд" },
  { key: "peer", label: "Сравнение" },
  { key: "acf", label: "АКФ" },
  { key: "protocol", label: "Протокол" },
];

const BASE_COLUMNS: { key: SortColumn; label: string }[] = [
  { key: "section_code", label: "Секция" },
  { key: "settlement_name", label: "Населено място" },
  { key: "risk_score", label: "Риск" },
  { key: "turnout_rate", label: "Избирателна активност" },
  { key: "turnout_zscore", label: "Z-Score" },
  { key: "benford_score", label: "Бенфорд" },
  { key: "peer_vote_deviation", label: "Отклонение" },
  { key: "arithmetic_error", label: "Аритм. грешка" },
  { key: "vote_sum_mismatch", label: "Несъответствие" },
  { key: "protocol_violation_count", label: "Нарушения" },
];

const RULE_LABELS: Record<string, string> = {
  "R3.1": "Сума гласове ≠ валидни",
  "R3.2": "Хартиени ≠ валидни",
  "R3.3": "Машинни ≠ валидни",
  "R4.1": "Преференции ≠ гласове",
  "R7.1": "Бюлетини извън диапазон",
  "R7.4": "Гласове > гласували",
  "R7.5": "Преференция > гласове",
};

function riskColor(score: number): string {
  if (score > 0.6) return "bg-red-500";
  if (score >= 0.3) return "bg-yellow-500";
  return "bg-green-500";
}

function riskBgStyle(score: number): React.CSSProperties {
  if (score > 0.6) return { backgroundColor: "#ef4444" };
  if (score >= 0.3) return { backgroundColor: "#eab308" };
  return { backgroundColor: "#22c55e" };
}

function formatCell(key: SortColumn, value: number | string): string {
  if (key === "section_code" || key === "settlement_name") return String(value);
  if (key === "turnout_rate") return ((value as number) * 100).toFixed(1) + "%";
  if (key === "turnout_zscore") return (value as number).toFixed(1);
  if (key === "risk_score" || key === "benford_score" || key === "peer_vote_deviation")
    return (value as number).toFixed(2);
  if (key === "arithmetic_error" || key === "vote_sum_mismatch")
    return (value as number) ? "Да" : "Не";
  if (key === "protocol_violation_count") return String(value as number);
  return String(value);
}

function ViolationRow({ electionId, sectionCode, colSpan }: { electionId: string; sectionCode: string; colSpan: number }) {
  const [violations, setViolations] = useState<Violation[] | null>(null);

  useEffect(() => {
    fetch(`/api/elections/${electionId}/violations/${sectionCode}`)
      .then((r) => r.ok ? r.json() : { violations: [] })
      .then((d: { violations: Violation[] }) => setViolations(d.violations))
      .catch(() => setViolations([]));
  }, [electionId, sectionCode]);

  return (
    <tr>
      <td colSpan={colSpan} style={{ padding: 0, borderBottom: "2px solid #333" }}>
        <div style={{ padding: "0.5rem 1rem", backgroundColor: "#f9fafb" }}>
          {violations === null ? (
            <div style={{ fontSize: "0.8rem", color: "#888" }}>Зареждане...</div>
          ) : violations.length === 0 ? (
            <div style={{ fontSize: "0.8rem", color: "#888" }}>Няма нарушения в протокола</div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #ddd" }}>
                  <th style={{ padding: "0.25rem 0.5rem", textAlign: "left", fontWeight: 600, width: "5rem" }}>Правило</th>
                  <th style={{ padding: "0.25rem 0.5rem", textAlign: "left", fontWeight: 600 }}>Описание</th>
                  <th style={{ padding: "0.25rem 0.5rem", textAlign: "right", fontWeight: 600, width: "7rem" }}>Очаквано</th>
                  <th style={{ padding: "0.25rem 0.5rem", textAlign: "right", fontWeight: 600, width: "7rem" }}>Получено</th>
                  <th style={{ padding: "0.25rem 0.5rem", textAlign: "center", fontWeight: 600, width: "5rem" }}>Тежест</th>
                </tr>
              </thead>
              <tbody>
                {violations.map((v, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid #eee" }}>
                    <td style={{
                      padding: "0.25rem 0.5rem",
                      fontFamily: "monospace",
                      fontSize: "0.75rem",
                      color: "#666",
                    }}>
                      {v.rule_id}
                    </td>
                    <td style={{ padding: "0.25rem 0.5rem" }}>
                      {v.description}
                    </td>
                    <td style={{
                      padding: "0.25rem 0.5rem",
                      textAlign: "right",
                      fontFamily: "monospace",
                    }}>
                      {v.expected_value}
                    </td>
                    <td style={{
                      padding: "0.25rem 0.5rem",
                      textAlign: "right",
                      fontFamily: "monospace",
                      fontWeight: 600,
                    }}>
                      {v.actual_value}
                    </td>
                    <td style={{
                      padding: "0.25rem 0.5rem",
                      textAlign: "center",
                    }}>
                      <span style={{
                        display: "inline-block",
                        padding: "0.1rem 0.4rem",
                        borderRadius: "3px",
                        fontSize: "0.7rem",
                        fontWeight: 600,
                        backgroundColor: v.severity === "error" ? "#fecaca" : "#fef3c7",
                        color: v.severity === "error" ? "#991b1b" : "#92400e",
                      }}>
                        {v.severity === "error" ? "грешка" : "забележка"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </td>
    </tr>
  );
}

export default function SectionAnomalies() {
  const { id } = useParams();

  const [methodology, setMethodology] = useState<Methodology>("combined");
  const [minRisk, setMinRisk] = useState(0.3);
  const [sort, setSort] = useState<SortColumn>("risk_score");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [offset, setOffset] = useState(0);
  const [filterParam, setFilterParam] = useState<string | null>(null);
  const [filterValue, setFilterValue] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"table" | "map">("table");
  const [expandedSection, setExpandedSection] = useState<string | null>(null);

  const [data, setData] = useState<AnomaliesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [mapSections, setMapSections] = useState<ScoredSection[]>([]);
  const [mapLoading, setMapLoading] = useState(false);

  const LIMIT = 50;

  // Show different columns depending on methodology
  const columns = methodology === "protocol"
    ? BASE_COLUMNS.filter((c) =>
        ["section_code", "settlement_name", "protocol_violation_count", "risk_score", "turnout_rate"].includes(c.key)
      )
    : BASE_COLUMNS;

  const buildUrl = useCallback(
    (overrideLimit?: number, overrideOffset?: number) => {
      const params = new URLSearchParams();
      params.set("min_risk", methodology === "protocol" ? "1" : String(minRisk));
      params.set("sort", sort);
      params.set("order", order);
      params.set("limit", String(overrideLimit ?? LIMIT));
      params.set("offset", String(overrideOffset ?? offset));
      if (methodology !== "combined") {
        params.set("methodology", methodology);
      }
      if (filterParam && filterValue) {
        params.set(filterParam, filterValue);
      }
      return `/api/elections/${id}/anomalies?${params}`;
    },
    [id, methodology, minRisk, sort, order, offset, filterParam, filterValue]
  );

  // Fetch table data
  useEffect(() => {
    setLoading(true);
    setError(null);
    setExpandedSection(null);
    fetch(buildUrl())
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [buildUrl]);

  // Fetch map data (separate request with limit=500)
  useEffect(() => {
    if (viewMode !== "map") return;
    setMapLoading(true);
    const params = new URLSearchParams();
    params.set("min_risk", methodology === "protocol" ? "1" : String(minRisk));
    params.set("sort", methodology === "protocol" ? "protocol_violation_count" : "risk_score");
    params.set("order", "desc");
    params.set("limit", "500");
    params.set("offset", "0");
    if (methodology !== "combined") {
      params.set("methodology", methodology);
    }
    if (filterParam && filterValue) {
      params.set(filterParam, filterValue);
    }
    fetch(`/api/elections/${id}/anomalies?${params}`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((body: AnomaliesResponse) => setMapSections(body.sections))
      .catch(() => {})
      .finally(() => setMapLoading(false));
  }, [id, methodology, minRisk, filterParam, filterValue, viewMode]);

  const handleFilterChange = useCallback(
    (param: string | null, value: string | null) => {
      setFilterParam(param);
      setFilterValue(value);
      setOffset(0);
    },
    []
  );

  const handleSort = useCallback(
    (col: SortColumn) => {
      if (col === sort) {
        setOrder((o) => (o === "asc" ? "desc" : "asc"));
      } else {
        setSort(col);
        setOrder("desc");
      }
      setOffset(0);
    },
    [sort]
  );

  const total = data?.total ?? 0;
  const sections = data?.sections ?? [];
  const endIndex = Math.min(offset + sections.length, total);

  // Fetch violation summary for protocol mode header
  const [violationSummary, setViolationSummary] = useState<{
    sections_with_violations: number;
    total_violations: number;
    rules: { rule_id: string; severity: string; count: number; sections_affected: number }[];
  } | null>(null);

  useEffect(() => {
    if (methodology !== "protocol" || !id) {
      setViolationSummary(null);
      return;
    }
    fetch(`/api/elections/${id}/violations`)
      .then((r) => r.ok ? r.json() : null)
      .then(setViolationSummary)
      .catch(() => {});
  }, [id, methodology]);

  return (
    <div style={{ padding: "1rem" }}>
      <p>
        <Link to={data ? `/elections/${data.election.id}` : "/"}>
          Back to election
        </Link>
        {" | "}
        <Link to="/">All elections</Link>
      </p>

      {data && (
        <h1>
          Anomaly Viewer: {data.election.name}
        </h1>
      )}

      {/* Methodology selector */}
      <div style={{ margin: "1rem 0", display: "flex", gap: "0.25rem", flexWrap: "wrap" }}>
        {METHODOLOGY_LABELS.map((m) => (
          <button
            key={m.key}
            onClick={() => {
              setMethodology(m.key);
              setOffset(0);
              setExpandedSection(null);
              if (m.key === "protocol") {
                setSort("protocol_violation_count");
                setOrder("desc");
              } else if (sort === "protocol_violation_count") {
                setSort("risk_score");
              }
            }}
            style={{
              padding: "0.35rem 0.75rem",
              border: methodology === m.key ? "2px solid #333" : "1px solid #ccc",
              backgroundColor: methodology === m.key ? "#333" : "#fff",
              color: methodology === m.key ? "#fff" : "#333",
              borderRadius: "4px",
              cursor: "pointer",
              fontWeight: methodology === m.key ? "bold" : "normal",
              fontSize: "0.85rem",
            }}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* Violation summary for protocol mode */}
      {methodology === "protocol" && violationSummary && (
        <div style={{
          margin: "0.5rem 0 1rem",
          padding: "0.75rem 1rem",
          backgroundColor: "#f9fafb",
          border: "1px solid #e5e7eb",
          borderRadius: "6px",
          fontSize: "0.85rem",
        }}>
          <div style={{ marginBottom: "0.5rem" }}>
            <strong>{violationSummary.sections_with_violations}</strong> секции с{" "}
            <strong>{violationSummary.total_violations}</strong> нарушения общо
          </div>
          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
            {/* Group by rule_id, merge severities */}
            {Object.entries(
              violationSummary.rules.reduce<Record<string, { errors: number; warnings: number; sections: number }>>((acc, r) => {
                if (!acc[r.rule_id]) acc[r.rule_id] = { errors: 0, warnings: 0, sections: 0 };
                if (r.severity === "error") acc[r.rule_id].errors = r.count;
                else acc[r.rule_id].warnings = r.count;
                acc[r.rule_id].sections = Math.max(acc[r.rule_id].sections, r.sections_affected);
                return acc;
              }, {})
            ).map(([rule, counts]) => (
              <span
                key={rule}
                style={{
                  padding: "0.2rem 0.5rem",
                  backgroundColor: counts.errors > 0 ? "#fecaca" : "#fef3c7",
                  borderRadius: "4px",
                  fontSize: "0.75rem",
                  fontFamily: "monospace",
                }}
                title={`${counts.errors} грешки, ${counts.warnings} забележки`}
              >
                {rule} {RULE_LABELS[rule] ?? ""}: {counts.errors + counts.warnings}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Risk threshold slider — hidden for protocol methodology */}
      {methodology !== "protocol" && (
        <div style={{ margin: "1rem 0" }}>
          <label>
            Праг на риска: <strong>{minRisk.toFixed(2)}</strong>{" "}
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={minRisk}
              onChange={(e) => {
                setMinRisk(parseFloat(e.target.value));
                setOffset(0);
              }}
              style={{ verticalAlign: "middle", width: "200px" }}
            />
          </label>
        </div>
      )}

      {/* Location filter */}
      <LocationFilter onFilterChange={handleFilterChange} />

      {/* View toggle */}
      <div style={{ margin: "1rem 0", display: "flex", gap: "0.5rem" }}>
        <button
          onClick={() => setViewMode("table")}
          style={{
            padding: "0.4rem 1rem",
            fontWeight: viewMode === "table" ? "bold" : "normal",
            border: "1px solid #ccc",
            backgroundColor: viewMode === "table" ? "#e0e0e0" : "#fff",
            cursor: "pointer",
          }}
        >
          Table
        </button>
        <button
          onClick={() => setViewMode("map")}
          style={{
            padding: "0.4rem 1rem",
            fontWeight: viewMode === "map" ? "bold" : "normal",
            border: "1px solid #ccc",
            backgroundColor: viewMode === "map" ? "#e0e0e0" : "#fff",
            cursor: "pointer",
          }}
        >
          Map
        </button>
      </div>

      {loading && <p>Loading...</p>}
      {error && <p>Error: {error}</p>}

      {!loading && !error && viewMode === "table" && (
        <>
          {sections.length === 0 ? (
            <p>Няма секции{methodology === "protocol" ? " с нарушения" : " над прага"}</p>
          ) : (
            <>
              <table style={{ borderCollapse: "collapse", width: "100%" }}>
                <thead>
                  <tr>
                    {columns.map((col) => (
                      <th
                        key={col.key}
                        onClick={() => handleSort(col.key)}
                        style={{
                          cursor: "pointer",
                          padding: "0.5rem",
                          borderBottom: "2px solid #333",
                          textAlign: "left",
                          whiteSpace: "nowrap",
                          userSelect: "none",
                        }}
                      >
                        {col.label}
                        {sort === col.key ? (order === "asc" ? " \u25B2" : " \u25BC") : ""}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sections.map((s) => (
                    <>
                      <tr
                        key={s.section_code}
                        onClick={() => setExpandedSection(expandedSection === s.section_code ? null : s.section_code)}
                        style={{
                          cursor: s.protocol_violation_count > 0 ? "pointer" : "default",
                          backgroundColor: expandedSection === s.section_code ? "#f3f4f6" : undefined,
                        }}
                      >
                        {columns.map((col) => (
                          <td
                            key={col.key}
                            style={{
                              padding: "0.4rem 0.5rem",
                              borderBottom: expandedSection === s.section_code ? "none" : "1px solid #ddd",
                              ...(col.key === "risk_score"
                                ? {
                                    ...riskBgStyle(s.risk_score),
                                    color: "#fff",
                                    fontWeight: "bold",
                                  }
                                : {}),
                              ...(col.key === "protocol_violation_count" && s.protocol_violation_count > 0
                                ? {
                                    fontWeight: "bold",
                                    color: s.protocol_violation_count >= 3 ? "#dc2626" : "#d97706",
                                  }
                                : {}),
                            }}
                          >
                            {formatCell(col.key, s[col.key])}
                            {col.key === "protocol_violation_count" && s.protocol_violation_count > 0 && (
                              <span style={{ marginLeft: "0.3rem", fontSize: "0.7rem", color: "#888" }}>
                                {expandedSection === s.section_code ? "▲" : "▼"}
                              </span>
                            )}
                          </td>
                        ))}
                      </tr>
                      {expandedSection === s.section_code && s.protocol_violation_count > 0 && id && (
                        <ViolationRow
                          key={`${s.section_code}-violations`}
                          electionId={id}
                          sectionCode={s.section_code}
                          colSpan={columns.length}
                        />
                      )}
                    </>
                  ))}
                </tbody>
              </table>

              {/* Pagination */}
              <div style={{ marginTop: "1rem", display: "flex", gap: "1rem", alignItems: "center" }}>
                <button
                  disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - LIMIT))}
                  style={{ padding: "0.3rem 0.8rem", cursor: offset === 0 ? "default" : "pointer" }}
                >
                  Previous
                </button>
                <span>
                  Showing {offset + 1}&ndash;{endIndex} of {total}
                </span>
                <button
                  disabled={offset + LIMIT >= total}
                  onClick={() => setOffset(offset + LIMIT)}
                  style={{
                    padding: "0.3rem 0.8rem",
                    cursor: offset + LIMIT >= total ? "default" : "pointer",
                  }}
                >
                  Next
                </button>
              </div>
            </>
          )}
        </>
      )}

      {!loading && !error && viewMode === "map" && (
        <>
          {mapLoading && <p>Loading map data...</p>}

          {/* Legend */}
          <div style={{ display: "flex", gap: "1rem", marginBottom: "0.5rem", alignItems: "center" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem" }}>
              <span style={{ display: "inline-block", width: 12, height: 12, borderRadius: "50%", backgroundColor: "#22c55e" }} />
              Low Risk &lt; 0.3
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem" }}>
              <span style={{ display: "inline-block", width: 12, height: 12, borderRadius: "50%", backgroundColor: "#eab308" }} />
              Medium 0.3&ndash;0.6
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem" }}>
              <span style={{ display: "inline-block", width: 12, height: 12, borderRadius: "50%", backgroundColor: "#ef4444" }} />
              High &gt; 0.6
            </span>
          </div>

          <div style={{ height: "600px", width: "100%" }}>
            <Map center={[25.5, 42.7]} zoom={7} className="h-full w-full rounded-lg border">
              {mapSections
                .filter((s) => s.lat != null && s.lng != null)
                .map((s) => (
                  <MapMarker key={s.section_code} longitude={s.lng!} latitude={s.lat!}>
                    <MarkerContent>
                      <div
                        className={`size-3 rounded-full border-2 border-white ${riskColor(s.risk_score)}`}
                      />
                    </MarkerContent>
                    <MarkerPopup>
                      <div style={{ padding: "0.5rem", minWidth: "180px" }}>
                        <div><strong>{s.section_code}</strong></div>
                        <div>{s.settlement_name}</div>
                        <div>Risk: {s.risk_score.toFixed(2)}</div>
                        <div>Turnout: {(s.turnout_rate * 100).toFixed(1)}%</div>
                        <div>Z-Score: {s.turnout_zscore.toFixed(1)}</div>
                        {s.arithmetic_error ? <div>Аритметична грешка: Да</div> : null}
                        {s.vote_sum_mismatch ? <div>Несъответствие: Да</div> : null}
                        {s.protocol_violation_count > 0 ? <div>Нарушения в протокола: {s.protocol_violation_count}</div> : null}
                      </div>
                    </MarkerPopup>
                  </MapMarker>
                ))}
            </Map>
          </div>
        </>
      )}
    </div>
  );
}
