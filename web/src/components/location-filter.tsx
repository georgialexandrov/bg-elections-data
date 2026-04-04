import { useEffect, useState, useCallback } from "react";

interface GeoEntity {
  id: number;
  name: string;
}

interface LocationFilterProps {
  onFilterChange: (param: string | null, value: string | null) => void;
  initialParam?: string | null;
  initialValue?: string | null;
}

export default function LocationFilter({
  onFilterChange,
  initialParam,
  initialValue,
}: LocationFilterProps) {
  const [riks, setRiks] = useState<GeoEntity[]>([]);
  const [districts, setDistricts] = useState<GeoEntity[]>([]);
  const [municipalities, setMunicipalities] = useState<GeoEntity[]>([]);
  const [kmetstva, setKmetstva] = useState<GeoEntity[]>([]);
  const [localRegions, setLocalRegions] = useState<GeoEntity[]>([]);

  const [selectedRik, setSelectedRik] = useState("");
  const [selectedDistrict, setSelectedDistrict] = useState("");
  const [selectedMunicipality, setSelectedMunicipality] = useState("");
  const [selectedKmetstvo, setSelectedKmetstvo] = useState("");
  const [selectedLocalRegion, setSelectedLocalRegion] = useState("");

  const [initialized, setInitialized] = useState(false);

  // Fetch top-level lists on mount
  useEffect(() => {
    Promise.all([
      fetch("/api/geography/riks").then((r) => r.json()),
      fetch("/api/geography/districts").then((r) => r.json()),
    ]).then(([riksData, districtsData]) => {
      setRiks(riksData);
      setDistricts(districtsData);
    });
  }, []);

  // Initialize from URL params after top-level data loads
  useEffect(() => {
    if (initialized || districts.length === 0) return;
    if (!initialParam || !initialValue) {
      setInitialized(true);
      return;
    }

    const init = async () => {
      if (initialParam === "rik") {
        setSelectedRik(initialValue);
      } else if (initialParam === "district") {
        setSelectedDistrict(initialValue);
        // Load municipalities for this district
        const munis = await fetch(
          `/api/geography/municipalities?district=${initialValue}`
        ).then((r) => r.json());
        setMunicipalities(munis);
      } else if (initialParam === "municipality") {
        // Find the district for this municipality to load siblings
        const allMunis: GeoEntity[] = await fetch(
          "/api/geography/municipalities"
        ).then((r) => r.json());
        setMunicipalities(allMunis);
        setSelectedMunicipality(initialValue);
        // Load children
        const [km, lr] = await Promise.all([
          fetch(`/api/geography/kmetstva?municipality=${initialValue}`).then(
            (r) => r.json()
          ),
          fetch(
            `/api/geography/local-regions?municipality=${initialValue}`
          ).then((r) => r.json()),
        ]);
        setKmetstva(km);
        setLocalRegions(lr);
      } else if (initialParam === "kmetstvo") {
        const allMunis: GeoEntity[] = await fetch(
          "/api/geography/municipalities"
        ).then((r) => r.json());
        setMunicipalities(allMunis);
        const allKm: GeoEntity[] = await fetch("/api/geography/kmetstva").then(
          (r) => r.json()
        );
        setKmetstva(allKm);
        setSelectedKmetstvo(initialValue);
      } else if (initialParam === "local_region") {
        const allMunis: GeoEntity[] = await fetch(
          "/api/geography/municipalities"
        ).then((r) => r.json());
        setMunicipalities(allMunis);
        const allLr: GeoEntity[] = await fetch(
          "/api/geography/local-regions"
        ).then((r) => r.json());
        setLocalRegions(allLr);
        setSelectedLocalRegion(initialValue);
      }
      setInitialized(true);
    };
    init();
  }, [initialized, initialParam, initialValue, districts]);

  // When district changes, fetch municipalities
  const handleDistrictChange = useCallback(
    (value: string) => {
      setSelectedDistrict(value);
      setSelectedMunicipality("");
      setSelectedKmetstvo("");
      setSelectedLocalRegion("");
      setKmetstva([]);
      setLocalRegions([]);

      if (value) {
        fetch(`/api/geography/municipalities?district=${value}`)
          .then((r) => r.json())
          .then(setMunicipalities);
        onFilterChange("district", value);
      } else {
        setMunicipalities([]);
        onFilterChange(null, null);
      }
    },
    [onFilterChange]
  );

  // When municipality changes, fetch kmetstva and local regions
  const handleMunicipalityChange = useCallback(
    (value: string) => {
      setSelectedMunicipality(value);
      setSelectedKmetstvo("");
      setSelectedLocalRegion("");

      if (value) {
        Promise.all([
          fetch(`/api/geography/kmetstva?municipality=${value}`).then((r) =>
            r.json()
          ),
          fetch(`/api/geography/local-regions?municipality=${value}`).then(
            (r) => r.json()
          ),
        ]).then(([km, lr]) => {
          setKmetstva(km);
          setLocalRegions(lr);
        });
        onFilterChange("municipality", value);
      } else {
        setKmetstva([]);
        setLocalRegions([]);
        // Fall back to district filter if district is selected
        if (selectedDistrict) {
          onFilterChange("district", selectedDistrict);
        } else {
          onFilterChange(null, null);
        }
      }
    },
    [onFilterChange, selectedDistrict]
  );

  return (
    <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginBottom: "1rem" }}>
      <label>
        RIK:{" "}
        <select
          value={selectedRik}
          onChange={(e) => {
            const val = e.target.value;
            setSelectedRik(val);
            setSelectedDistrict("");
            setSelectedMunicipality("");
            setSelectedKmetstvo("");
            setSelectedLocalRegion("");
            setMunicipalities([]);
            setKmetstva([]);
            setLocalRegions([]);
            onFilterChange(val ? "rik" : null, val || null);
          }}
        >
          <option value="">All</option>
          {riks.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </label>

      <label>
        District:{" "}
        <select
          value={selectedDistrict}
          onChange={(e) => {
            setSelectedRik("");
            handleDistrictChange(e.target.value);
          }}
        >
          <option value="">All</option>
          {districts.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </label>

      <label>
        Municipality:{" "}
        <select
          value={selectedMunicipality}
          onChange={(e) => {
            setSelectedRik("");
            handleMunicipalityChange(e.target.value);
          }}
          disabled={municipalities.length === 0}
        >
          <option value="">All</option>
          {municipalities.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </label>

      <label>
        Kmetstvo:{" "}
        <select
          value={selectedKmetstvo}
          onChange={(e) => {
            const val = e.target.value;
            setSelectedKmetstvo(val);
            setSelectedLocalRegion("");
            setSelectedRik("");
            onFilterChange(val ? "kmetstvo" : selectedMunicipality ? "municipality" : null, val || selectedMunicipality || null);
          }}
          disabled={kmetstva.length === 0}
        >
          <option value="">All</option>
          {kmetstva.map((k) => (
            <option key={k.id} value={k.id}>
              {k.name}
            </option>
          ))}
        </select>
      </label>

      <label>
        Local Region:{" "}
        <select
          value={selectedLocalRegion}
          onChange={(e) => {
            const val = e.target.value;
            setSelectedLocalRegion(val);
            setSelectedKmetstvo("");
            setSelectedRik("");
            onFilterChange(val ? "local_region" : selectedMunicipality ? "municipality" : null, val || selectedMunicipality || null);
          }}
          disabled={localRegions.length === 0}
        >
          <option value="">All</option>
          {localRegions.map((lr) => (
            <option key={lr.id} value={lr.id}>
              {lr.name}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
