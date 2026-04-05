import { useEffect, useState, useCallback } from "react";
import { Link, useSearchParams } from "react-router";
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

interface PartyElectionData {
  votes: number;
  percentage: number;
}

interface ComparePartyResult {
  party_id: number;
  party_name: string;
  elections: Record<string, PartyElectionData>;
}

interface CompareResponse {
  elections: Election[];
  results: ComparePartyResult[];
}

const GEO_PARAMS = ["rik", "district", "municipality", "kmetstvo", "local_region"] as const;

const CHART_COLORS = [
  "#4e79a7", "#f28e2b", "#e15759", "#76b7b2", "#59a14f",
  "#edc948", "#b07aa1", "#ff9da7", "#9c755f", "#bab0ac",
];

export default function CompareElections() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [allElections, setAllElections] = useState<Election[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => {
    const param = searchParams.get("elections");
    if (!param) return new Set();
    return new Set(param.split(",").map(Number).filter((n) => !isNaN(n)));
  });
  const [data, setData] = useState<CompareResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [geoFilter, setGeoFilter] = useState<{ param: string | null; value: string | null }>(() => {
    const p = GEO_PARAMS.find((p) => searchParams.has(p)) ?? null;
    return { param: p, value: p ? searchParams.get(p) : null };
  });

  // Fetch election list
  useEffect(() => {
    fetch("/api/elections")
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(setAllElections)
      .catch((err) => setError(err.message));
  }, []);

  // Update URL when selections change
  useEffect(() => {
    const params: Record<string, string> = {};
    if (selectedIds.size > 0) {
      params.elections = Array.from(selectedIds).join(",");
    }
    if (geoFilter.param && geoFilter.value) {
      params[geoFilter.param] = geoFilter.value;
    }
    setSearchParams(params, { replace: true });
  }, [selectedIds, geoFilter, setSearchParams]);

  // Fetch comparison data
  useEffect(() => {
    if (selectedIds.size < 2) {
      setData(null);
      return;
    }
    setLoading(true);
    setError(null);
    const ids = Array.from(selectedIds).join(",");
    let url = `/api/elections/compare?elections=${ids}`;
    if (geoFilter.param && geoFilter.value) {
      url += `&${geoFilter.param}=${geoFilter.value}`;
    }
    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [selectedIds, geoFilter]);

  const handleToggle = useCallback((id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleFilterChange = useCallback((param: string | null, value: string | null) => {
    setGeoFilter({ param, value });
  }, []);

  const activeParam = geoFilter.param;
  const activeValue = geoFilter.value;

  // Chart data: top 15 parties by total votes
  const chartData = data ? (() => {
    const top15 = data.results.slice(0, 15);
    const labels = top15.map((r) => r.party_name);
    const datasets = data.elections.map((el, idx) => ({
      label: `${el.name} (${el.date})`,
      data: top15.map((r) => r.elections[String(el.id)]?.percentage ?? 0),
      backgroundColor: CHART_COLORS[idx % CHART_COLORS.length],
    }));
    return { labels, datasets };
  })() : null;

  const chartOptions = {
    responsive: true,
    plugins: {
      legend: { position: "top" as const },
      title: { display: true, text: "Vote Share Comparison (%)" },
    },
    scales: {
      y: {
        beginAtZero: true,
        title: { display: true, text: "Percentage (%)" },
      },
    },
  };

  return (
    <div>
      <p>
        <Link to="/">Back to elections</Link>
      </p>
      <h1>Compare Elections</h1>

      <fieldset>
        <legend>Select elections to compare (2-10):</legend>
        {allElections.map((e) => (
          <label key={e.id} style={{ display: "block", margin: "0.25rem 0" }}>
            <input
              type="checkbox"
              checked={selectedIds.has(e.id)}
              onChange={() => handleToggle(e.id)}
              disabled={!selectedIds.has(e.id) && selectedIds.size >= 10}
            />
            {" "}{e.name} ({e.date})
          </label>
        ))}
      </fieldset>

      <LocationFilter
        onFilterChange={handleFilterChange}
        initialParam={activeParam}
        initialValue={activeValue}
      />

      {selectedIds.size < 2 && <p>Select at least 2 elections to compare.</p>}
      {loading && <p>Loading comparison...</p>}
      {error && <p>Error: {error}</p>}

      {!loading && !error && data && chartData && (
        <>
          <div style={{ maxWidth: "900px", margin: "1rem 0" }}>
            <Bar data={chartData} options={chartOptions} />
          </div>

          <table>
            <thead>
              <tr>
                <th>Party</th>
                {data.elections.map((el) => (
                  <th key={el.id} colSpan={2}>{el.name} ({el.date})</th>
                ))}
              </tr>
              <tr>
                <th />
                {data.elections.map((el) => (
                  <>
                    <th key={`${el.id}-v`}>Votes</th>
                    <th key={`${el.id}-p`}>%</th>
                  </>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.results.map((r) => (
                <tr key={r.party_id}>
                  <td>{r.party_name}</td>
                  {data.elections.map((el) => {
                    const d = r.elections[String(el.id)];
                    return (
                      <>
                        <td key={`${el.id}-v`}>{(d?.votes ?? 0).toLocaleString()}</td>
                        <td key={`${el.id}-p`}>{d?.percentage ?? 0}%</td>
                      </>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
