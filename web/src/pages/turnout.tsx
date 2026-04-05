import { useEffect, useState, useCallback } from "react";
import { useParams, useSearchParams, Link } from "react-router";
import LocationFilter from "../components/location-filter.js";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from "chart.js";
import { Bar } from "react-chartjs-2";

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

interface Election {
  id: number;
  name: string;
  date: string;
  type: string;
}

interface TurnoutEntry {
  group_id: number;
  group_name: string;
  registered_voters: number;
  actual_voters: number;
  turnout_pct: number;
}

interface TurnoutResponse {
  election: Election;
  turnout: TurnoutEntry[];
  totals: {
    registered_voters: number;
    actual_voters: number;
    turnout_pct: number;
  };
}

const GROUP_BY_OPTIONS = [
  { value: "district", label: "District" },
  { value: "municipality", label: "Municipality" },
  { value: "rik", label: "RIK" },
  { value: "kmetstvo", label: "Kmetstvo" },
  { value: "local_region", label: "Local Region" },
] as const;

const GEO_PARAMS = ["rik", "district", "municipality", "kmetstvo", "local_region"] as const;

export default function Turnout() {
  const { id } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState<TurnoutResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [groupBy, setGroupBy] = useState(
    searchParams.get("group_by") || "district"
  );
  const [sortByPct, setSortByPct] = useState(true);

  const activeParam = GEO_PARAMS.find((p) => searchParams.has(p)) ?? null;
  const activeValue = activeParam ? searchParams.get(activeParam) : null;

  const fetchTurnout = useCallback(
    (gb: string, param: string | null, value: string | null) => {
      setLoading(true);
      setError(null);
      let url = `/api/elections/${id}/turnout?group_by=${gb}`;
      if (param && value) {
        url += `&${param}=${value}`;
      }
      fetch(url)
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json();
        })
        .then(setData)
        .catch((err) => setError(err.message))
        .finally(() => setLoading(false));
    },
    [id]
  );

  useEffect(() => {
    fetchTurnout(groupBy, activeParam, activeValue);
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleFilterChange = useCallback(
    (param: string | null, value: string | null) => {
      const params: Record<string, string> = { group_by: groupBy };
      if (param && value) {
        params[param] = value;
      }
      setSearchParams(params);
      fetchTurnout(groupBy, param, value);
    },
    [fetchTurnout, setSearchParams, groupBy]
  );

  const handleGroupByChange = useCallback(
    (newGroupBy: string) => {
      setGroupBy(newGroupBy);
      const params: Record<string, string> = { group_by: newGroupBy };
      if (activeParam && activeValue) {
        params[activeParam] = activeValue;
      }
      setSearchParams(params);
      fetchTurnout(newGroupBy, activeParam, activeValue);
    },
    [fetchTurnout, setSearchParams, activeParam, activeValue]
  );

  const sortedTurnout = data
    ? [...data.turnout].sort((a, b) =>
        sortByPct
          ? b.turnout_pct - a.turnout_pct
          : a.group_name.localeCompare(b.group_name)
      )
    : [];

  const chartData = data
    ? {
        labels: sortedTurnout.map((t) => t.group_name),
        datasets: [
          {
            label: "Turnout %",
            data: sortedTurnout.map((t) => t.turnout_pct),
            backgroundColor: "#4e79a7",
          },
        ],
      }
    : null;

  const chartOptions = {
    indexAxis: "y" as const,
    responsive: true,
    plugins: {
      legend: { display: false },
      title: { display: true, text: "Voter Turnout by Region (%)" },
    },
    scales: {
      x: {
        beginAtZero: true,
        max: 100,
        title: { display: true, text: "Turnout (%)" },
      },
    },
  };

  return (
    <div>
      <p>
        <Link to="/">Back to elections</Link>
        {data && (
          <>
            {" | "}
            <Link to={`/elections/${id}`}>View results</Link>
          </>
        )}
      </p>
      {data && (
        <>
          <h1>{data.election.name} — Voter Turnout</h1>
          <p>
            Date: {data.election.date} | Type: {data.election.type}
          </p>
        </>
      )}

      <div style={{ display: "flex", gap: "1rem", alignItems: "center", marginBottom: "1rem" }}>
        <label>
          Group by:{" "}
          <select
            value={groupBy}
            onChange={(e) => handleGroupByChange(e.target.value)}
          >
            {GROUP_BY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={sortByPct}
            onChange={(e) => setSortByPct(e.target.checked)}
          />{" "}
          Sort by turnout %
        </label>
      </div>

      <LocationFilter
        onFilterChange={handleFilterChange}
        initialParam={activeParam}
        initialValue={activeValue}
      />

      {loading && <p>Loading turnout data...</p>}
      {error && <p>Error: {error}</p>}

      {!loading && !error && data && (
        <>
          <div
            style={{
              display: "flex",
              gap: "2rem",
              marginBottom: "1rem",
              padding: "1rem",
              background: "#f5f5f5",
              borderRadius: "4px",
            }}
          >
            <div>
              <strong>Registered voters:</strong>{" "}
              {data.totals.registered_voters.toLocaleString()}
            </div>
            <div>
              <strong>Actual voters:</strong>{" "}
              {data.totals.actual_voters.toLocaleString()}
            </div>
            <div>
              <strong>Turnout:</strong> {data.totals.turnout_pct}%
            </div>
          </div>

          {chartData && (
            <div
              style={{
                maxWidth: "900px",
                margin: "1rem 0",
                minHeight: Math.max(300, sortedTurnout.length * 25),
              }}
            >
              <Bar data={chartData} options={chartOptions} />
            </div>
          )}

          <table>
            <thead>
              <tr>
                <th>Region</th>
                <th>Registered</th>
                <th>Actual</th>
                <th>Turnout %</th>
              </tr>
            </thead>
            <tbody>
              {sortedTurnout.map((t) => (
                <tr key={t.group_id}>
                  <td>{t.group_name}</td>
                  <td>{t.registered_voters.toLocaleString()}</td>
                  <td>{t.actual_voters.toLocaleString()}</td>
                  <td>{t.turnout_pct}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
