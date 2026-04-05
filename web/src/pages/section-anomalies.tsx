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
}

interface AnomaliesResponse {
  election: Election;
  sections: ScoredSection[];
  total: number;
  limit: number;
  offset: number;
}

type SortColumn =
  | "risk_score"
  | "turnout_rate"
  | "turnout_zscore"
  | "benford_score"
  | "peer_vote_deviation"
  | "arithmetic_error"
  | "vote_sum_mismatch"
  | "section_code"
  | "settlement_name";

const COLUMNS: { key: SortColumn; label: string }[] = [
  { key: "section_code", label: "Section Code" },
  { key: "settlement_name", label: "Settlement" },
  { key: "risk_score", label: "Risk Score" },
  { key: "turnout_rate", label: "Turnout Rate" },
  { key: "turnout_zscore", label: "Turnout Z-Score" },
  { key: "benford_score", label: "Benford Score" },
  { key: "peer_vote_deviation", label: "Peer Vote Dev." },
  { key: "arithmetic_error", label: "Arith. Error" },
  { key: "vote_sum_mismatch", label: "Vote Mismatch" },
];

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
    return (value as number) ? "Yes" : "No";
  return String(value);
}

export default function SectionAnomalies() {
  const { id } = useParams();

  const [minRisk, setMinRisk] = useState(0.3);
  const [sort, setSort] = useState<SortColumn>("risk_score");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [offset, setOffset] = useState(0);
  const [filterParam, setFilterParam] = useState<string | null>(null);
  const [filterValue, setFilterValue] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"table" | "map">("table");

  const [data, setData] = useState<AnomaliesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [mapSections, setMapSections] = useState<ScoredSection[]>([]);
  const [mapLoading, setMapLoading] = useState(false);

  const LIMIT = 50;

  const buildUrl = useCallback(
    (overrideLimit?: number, overrideOffset?: number) => {
      const params = new URLSearchParams();
      params.set("min_risk", String(minRisk));
      params.set("sort", sort);
      params.set("order", order);
      params.set("limit", String(overrideLimit ?? LIMIT));
      params.set("offset", String(overrideOffset ?? offset));
      if (filterParam && filterValue) {
        params.set(filterParam, filterValue);
      }
      return `/api/elections/${id}/anomalies?${params}`;
    },
    [id, minRisk, sort, order, offset, filterParam, filterValue]
  );

  // Fetch table data
  useEffect(() => {
    setLoading(true);
    setError(null);
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
    params.set("min_risk", String(minRisk));
    params.set("sort", "risk_score");
    params.set("order", "desc");
    params.set("limit", "500");
    params.set("offset", "0");
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
  }, [id, minRisk, filterParam, filterValue, viewMode]);

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

      {/* Risk threshold slider */}
      <div style={{ margin: "1rem 0" }}>
        <label>
          Risk threshold: <strong>{minRisk.toFixed(2)}</strong>{" "}
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
            <p>No sections above threshold</p>
          ) : (
            <>
              <table style={{ borderCollapse: "collapse", width: "100%" }}>
                <thead>
                  <tr>
                    {COLUMNS.map((col) => (
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
                    <tr key={s.section_code}>
                      {COLUMNS.map((col) => (
                        <td
                          key={col.key}
                          style={{
                            padding: "0.4rem 0.5rem",
                            borderBottom: "1px solid #ddd",
                            ...(col.key === "risk_score"
                              ? {
                                  ...riskBgStyle(s.risk_score),
                                  color: "#fff",
                                  fontWeight: "bold",
                                }
                              : {}),
                          }}
                        >
                          {formatCell(col.key, s[col.key])}
                        </td>
                      ))}
                    </tr>
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
                        {s.arithmetic_error ? <div>Arithmetic Error: Yes</div> : null}
                        {s.vote_sum_mismatch ? <div>Vote Mismatch: Yes</div> : null}
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
