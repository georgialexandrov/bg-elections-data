import { useEffect, useMemo, useRef, useState } from "react";
import MapLibreGL from "maplibre-gl";
import bbox from "@turf/bbox";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import { point as turfPoint } from "@turf/helpers";
import {
  Map as MapComponent,
  MapControls,
  useMap,
} from "@/components/ui/map";
import { useAbroadByCountry } from "@/lib/hooks/use-geo-results.js";
import type { AbroadCountry } from "@/lib/api/types.js";

/**
 * Full-canvas world map showing the diaspora vote, country by country.
 * Lives on the "Чужбина" tab of the /results page as a peer to the
 * Bulgaria map — not an inset.
 *
 * Each country polygon is filled with the winner's color at low opacity
 * and then mosaiced with party-colored tile cells (same visual language
 * as the Bulgaria map in district-pie-map.tsx). Click a country → lift
 * it to the parent so the main legend can display that country's vote
 * breakdown.
 *
 * This component deliberately duplicates the tile-mosaic logic from
 * district-pie-map.tsx rather than pulling it into a shared helper —
 * the duplicated surface is small (~50 lines) and keeping the two
 * maps self-contained makes them easier to tune independently.
 */

const WORLD_GEOJSON_URL = "/world-countries-110m.geojson";
// Grid step for square tile mosaic, in degrees. Fine enough that
// the mosaic reads as a texture rather than blocky pixels even on
// mid-sized countries. 0.5° is the practical floor — smaller and
// huge countries (Russia, Canada) generate too many features for
// a single GeoJSON layer to stay smooth.
const GRID_STEP = 0.5;
const MIN_SHARE = 0.02;
const OTHER_COLOR = "#999";

const TILE_SOURCE = "abroad-tiles";
const TILE_LAYER = "abroad-tiles-fill";
const BG_SOURCE = "abroad-country-bg";
const BG_LAYER = "abroad-country-bg-fill";
const BORDER_SOURCE = "abroad-country-borders";
const BORDER_LAYER = "abroad-country-borders-line";

const BLANK_STYLE: MapLibreGL.StyleSpecification = {
  version: 8,
  name: "blank",
  sources: {},
  layers: [
    {
      id: "background",
      type: "background",
      paint: { "background-color": "#f4f4f4" },
    },
  ],
};

interface WorldFeature extends GeoJSON.Feature {
  properties: { iso2: string; name: string };
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
}

function seededRandom(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

/** Hash a string (iso2) to a stable numeric seed so tile placement
 *  is deterministic per country. */
function hashIso(iso: string): number {
  let h = 0;
  for (let i = 0; i < iso.length; i++) h = (h * 31 + iso.charCodeAt(i)) | 0;
  return h;
}

function buildCountryTiles(
  feature: WorldFeature,
  country: AbroadCountry,
): GeoJSON.Feature[] {
  const geo = feature.geometry;
  const [minX, minY, maxX, maxY] = bbox(feature);
  const half = GRID_STEP / 2;

  const cells: [number, number][] = [];
  for (let x = minX + half; x < maxX; x += GRID_STEP) {
    for (let y = minY + half; y < maxY; y += GRID_STEP) {
      const pt = turfPoint([x, y]);
      if (booleanPointInPolygon(pt, geo as any)) {
        cells.push([x, y]);
      }
    }
  }
  // Tiny country too small for the grid step (Malta, Luxembourg,
  // Singapore, …) — drop one cell at the geometry centroid so the
  // mosaic isn't empty. Still GRID_STEP wide so it matches the
  // rest of the map.
  if (cells.length === 0) {
    cells.push([(minX + maxX) / 2, (minY + maxY) / 2]);
  }

  type Slice = { label: string; color: string; share: number };
  const total = country.total_votes;
  if (total <= 0) return [];

  const slices: Slice[] = [];
  let otherShare = 0;
  for (const p of country.parties) {
    const share = p.votes / total;
    if (share >= MIN_SHARE) {
      slices.push({ label: p.name, color: p.color, share });
    } else {
      otherShare += share;
    }
  }
  if (otherShare > 0) {
    slices.push({ label: "Други", color: OTHER_COLOR, share: otherShare });
  }
  slices.sort((a, b) => b.share - a.share);

  const totalCells = cells.length;
  const colorAssignments: string[] = [];
  const labelAssignments: string[] = [];
  let remaining = totalCells;
  for (let i = 0; i < slices.length; i++) {
    const isLast = i === slices.length - 1;
    const count = isLast
      ? remaining
      : Math.max(1, Math.round(slices[i].share * totalCells));
    const actual = Math.min(count, remaining);
    for (let j = 0; j < actual; j++) {
      colorAssignments.push(slices[i].color);
      labelAssignments.push(slices[i].label);
    }
    remaining -= actual;
  }

  const rng = seededRandom(hashIso(country.iso2) * 7919);
  for (let i = colorAssignments.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [colorAssignments[i], colorAssignments[j]] = [
      colorAssignments[j],
      colorAssignments[i],
    ];
    [labelAssignments[i], labelAssignments[j]] = [
      labelAssignments[j],
      labelAssignments[i],
    ];
  }

  const features: GeoJSON.Feature[] = [];
  for (let i = 0; i < cells.length && i < colorAssignments.length; i++) {
    const [cx, cy] = cells[i];
    features.push({
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [cx - half, cy - half],
            [cx + half, cy - half],
            [cx + half, cy + half],
            [cx - half, cy + half],
            [cx - half, cy - half],
          ],
        ],
      },
      properties: {
        iso2: country.iso2,
        country_name: country.name,
        color: colorAssignments[i],
        party_name: labelAssignments[i],
      },
    });
  }
  return features;
}

function useWorldCountries() {
  const [data, setData] = useState<WorldFeature[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(WORLD_GEOJSON_URL)
      .then((r) => r.json())
      .then((geo: GeoJSON.FeatureCollection) => {
        if (cancelled) return;
        setData(geo.features as WorldFeature[]);
      })
      .catch(() => {
        if (!cancelled) setData([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return data;
}

function AbroadLayer({
  world,
  countries,
  selectedIso,
  hoveredIso,
  activeParty,
  onCountryClick,
  onCountryHover,
}: {
  world: WorldFeature[];
  countries: AbroadCountry[];
  selectedIso: string | null;
  hoveredIso: string | null;
  /** Party whose tiles should be highlighted (others dimmed). Comes
   *  from the legend's hover/tap state in the parent. */
  activeParty: string | null;
  onCountryClick: (iso: string | null) => void;
  onCountryHover: (iso: string | null, lngLat: [number, number] | null) => void;
}) {
  const { map, isLoaded } = useMap();
  const onClickRef = useRef(onCountryClick);
  const onHoverRef = useRef(onCountryHover);
  onClickRef.current = onCountryClick;
  onHoverRef.current = onCountryHover;

  // Match abroad data to world features by ISO-2. Every country
  // with voters is included — the whole diaspora is the story,
  // so we don't filter by geography. The fit bounds will cover
  // the union of country bboxes; tiles are generated per country
  // in its own polygon at an adaptive step.
  const matched = useMemo(() => {
    const byIso = new Map<string, AbroadCountry>();
    for (const c of countries) byIso.set(c.iso2, c);
    const out: { feature: WorldFeature; country: AbroadCountry }[] = [];
    for (const f of world) {
      const c = byIso.get(f.properties.iso2);
      if (c) out.push({ feature: f, country: c });
    }
    return out;
  }, [world, countries]);

  // Fit the viewport to Europe + near neighbours on first paint.
  //
  // We intentionally do NOT compute the bbox from the matched
  // countries. The diaspora spans North America, Russia, Australia,
  // South Africa etc., so a data-driven bbox spreads the view across
  // 150°+ of longitude and pushes Europe — where ~90% of voters
  // actually are — into a small corner of the canvas. Hardcoding
  // "roughly Europe" gives a predictable, readable default view on
  // every viewport size (mobile portrait included). Everything else
  // is still rendered and the user can pan/zoom to explore it.
  //
  // Deferred with a double-rAF + explicit `map.resize()` so the fit
  // runs against the final post-flex-layout container size, not the
  // stale size MapLibre sees on mount.
  const fittedRef = useRef(false);
  useEffect(() => {
    if (!map || !isLoaded || fittedRef.current || matched.length === 0) return;

    // Compute a fit bbox that covers countries with enough diaspora
    // to matter. Drop the long-tail (<0.3% of total voters) from
    // the fit calculation so a single section in Mongolia doesn't
    // force the view to span half the globe. Those countries are
    // still rendered — they just don't steer the initial viewport.
    const totalVoters = matched.reduce(
      (sum, { country }) => sum + country.actual_voters,
      0,
    );
    const significant = matched.filter(
      ({ country }) =>
        country.actual_voters >= Math.max(100, totalVoters * 0.003),
    );
    const source = significant.length > 0 ? significant : matched;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const { feature } of source) {
      const [x1, y1, x2, y2] = bbox(feature);
      if (x1 < minX) minX = x1;
      if (y1 < minY) minY = y1;
      if (x2 > maxX) maxX = x2;
      if (y2 > maxY) maxY = y2;
    }
    if (!isFinite(minX)) return;

    const runFit = () => {
      map.resize();
      map.fitBounds(
        [
          [minX, minY],
          [maxX, maxY],
        ],
        {
          padding: { top: 72, bottom: 24, left: 16, right: 16 },
          animate: false,
        },
      );
      fittedRef.current = true;
    };

    const raf1 = requestAnimationFrame(() => {
      const raf2 = requestAnimationFrame(runFit);
      (raf1 as unknown as { inner?: number }).inner = raf2;
    });
    return () => {
      cancelAnimationFrame(raf1);
      const inner = (raf1 as unknown as { inner?: number }).inner;
      if (inner != null) cancelAnimationFrame(inner);
    };
  }, [map, isLoaded, matched]);

  const backgroundData = useMemo<GeoJSON.FeatureCollection>(
    () => ({
      type: "FeatureCollection",
      features: matched.map(({ feature, country }) => ({
        type: "Feature",
        geometry: feature.geometry,
        properties: {
          iso2: country.iso2,
          name: country.name,
          winner_color: country.winner?.color ?? "#999",
          actual_voters: country.actual_voters,
        },
      })),
    }),
    [matched],
  );

  const tileData = useMemo<GeoJSON.FeatureCollection>(() => {
    const features: GeoJSON.Feature[] = [];
    for (const { feature, country } of matched) {
      features.push(...buildCountryTiles(feature, country));
    }
    return { type: "FeatureCollection", features };
  }, [matched]);

  const borderData = useMemo<GeoJSON.FeatureCollection>(
    () => ({
      type: "FeatureCollection",
      features: matched.map(({ feature, country }) => ({
        type: "Feature",
        geometry: feature.geometry,
        properties: { iso2: country.iso2, name: country.name },
      })),
    }),
    [matched],
  );

  // Background (winner fill)
  useEffect(() => {
    if (!map || !isLoaded) return;
    const existing = map.getSource(BG_SOURCE);
    if (existing) {
      (existing as MapLibreGL.GeoJSONSource).setData(backgroundData as any);
    } else {
      map.addSource(BG_SOURCE, { type: "geojson", data: backgroundData as any });
      map.addLayer({
        id: BG_LAYER,
        type: "fill",
        source: BG_SOURCE,
        paint: {
          "fill-color": ["get", "winner_color"],
          "fill-opacity": 0.25,
        },
      });
    }
    return () => {
      try {
        if (map.getLayer(BG_LAYER)) map.removeLayer(BG_LAYER);
        if (map.getSource(BG_SOURCE)) map.removeSource(BG_SOURCE);
      } catch {
        /* destroyed */
      }
    };
  }, [map, isLoaded, backgroundData]);

  // Tile mosaic
  useEffect(() => {
    if (!map || !isLoaded) return;
    const existing = map.getSource(TILE_SOURCE);
    if (existing) {
      (existing as MapLibreGL.GeoJSONSource).setData(tileData as any);
    } else {
      map.addSource(TILE_SOURCE, { type: "geojson", data: tileData as any });
      map.addLayer({
        id: TILE_LAYER,
        type: "fill",
        source: TILE_SOURCE,
        paint: {
          "fill-color": ["get", "color"],
          "fill-opacity": 0.9,
        },
      });
    }
    return () => {
      try {
        if (map.getLayer(TILE_LAYER)) map.removeLayer(TILE_LAYER);
        if (map.getSource(TILE_SOURCE)) map.removeSource(TILE_SOURCE);
      } catch {
        /* destroyed */
      }
    };
  }, [map, isLoaded, tileData]);

  // Country borders on top — highlight selected
  useEffect(() => {
    if (!map || !isLoaded) return;
    const existing = map.getSource(BORDER_SOURCE);
    if (existing) {
      (existing as MapLibreGL.GeoJSONSource).setData(borderData as any);
    } else {
      map.addSource(BORDER_SOURCE, { type: "geojson", data: borderData as any });
      map.addLayer({
        id: BORDER_LAYER,
        type: "line",
        source: BORDER_SOURCE,
        paint: {
          "line-color": "#555",
          "line-width": 0.5,
        },
      });
    }
    return () => {
      try {
        if (map.getLayer(BORDER_LAYER)) map.removeLayer(BORDER_LAYER);
        if (map.getSource(BORDER_SOURCE)) map.removeSource(BORDER_SOURCE);
      } catch {
        /* destroyed */
      }
    };
  }, [map, isLoaded, borderData]);

  // Dim non-selected countries when one is picked, and draw a
  // thicker/darker outline on the hovered country so the user can
  // see *which* country the legend preview is pointing at even for
  // small Balkan/Baltic ones.
  useEffect(() => {
    if (!map || !isLoaded) return;
    if (!map.getLayer(TILE_LAYER)) return;
    // Priority:
    //   activeParty + selectedIso → only that party in that country
    //   activeParty               → only that party, anywhere
    //   selectedIso               → only that country, any party
    //   else                      → full opacity everywhere
    let opacity: MapLibreGL.ExpressionSpecification | number;
    if (activeParty && selectedIso) {
      opacity = [
        "case",
        [
          "all",
          ["==", ["get", "iso2"], selectedIso],
          ["==", ["get", "party_name"], activeParty],
        ],
        1,
        0.06,
      ];
    } else if (activeParty) {
      opacity = [
        "case",
        ["==", ["get", "party_name"], activeParty],
        1,
        0.06,
      ];
    } else if (selectedIso) {
      opacity = [
        "case",
        ["==", ["get", "iso2"], selectedIso],
        1,
        0.15,
      ];
    } else {
      opacity = 0.9;
    }
    map.setPaintProperty(TILE_LAYER, "fill-opacity", opacity);
    const bgOpacity: MapLibreGL.ExpressionSpecification | number = selectedIso
      ? ["case", ["==", ["get", "iso2"], selectedIso], 0.5, 0.1]
      : 0.25;
    if (map.getLayer(BG_LAYER)) {
      map.setPaintProperty(BG_LAYER, "fill-opacity", bgOpacity);
    }
    if (map.getLayer(BORDER_LAYER)) {
      // Three tiers: hovered (thickest + darkest) > selected > idle.
      // Data-driven so the state lives in one paint expression and
      // doesn't require a second layer.
      const lineWidth: MapLibreGL.ExpressionSpecification | number =
        hoveredIso != null || selectedIso != null
          ? [
              "case",
              ["==", ["get", "iso2"], hoveredIso ?? "__none__"],
              2.5,
              ["==", ["get", "iso2"], selectedIso ?? "__none__"],
              1.8,
              0.5,
            ]
          : 0.5;
      const lineColor: MapLibreGL.ExpressionSpecification | string =
        hoveredIso != null || selectedIso != null
          ? [
              "case",
              ["==", ["get", "iso2"], hoveredIso ?? "__none__"],
              "#111",
              ["==", ["get", "iso2"], selectedIso ?? "__none__"],
              "#333",
              "#666",
            ]
          : "#555";
      map.setPaintProperty(BORDER_LAYER, "line-width", lineWidth);
      map.setPaintProperty(BORDER_LAYER, "line-color", lineColor);
    }
  }, [map, isLoaded, selectedIso, hoveredIso, activeParty]);

  // Click + hover handlers
  useEffect(() => {
    if (!map || !isLoaded) return;

    const handleClick = (e: MapLibreGL.MapMouseEvent) => {
      const features = map.queryRenderedFeatures(e.point, {
        layers: [BG_LAYER, TILE_LAYER],
      });
      if (!features.length) {
        onClickRef.current(null);
        return;
      }
      const iso = features[0].properties?.iso2;
      if (typeof iso === "string") onClickRef.current(iso);
    };

    const handleMove = (e: MapLibreGL.MapMouseEvent) => {
      const features = map.queryRenderedFeatures(e.point, {
        layers: [BG_LAYER, TILE_LAYER],
      });
      if (!features.length) {
        map.getCanvas().style.cursor = "";
        onHoverRef.current(null, null);
        return;
      }
      map.getCanvas().style.cursor = "pointer";
      const iso = features[0].properties?.iso2;
      if (typeof iso === "string") {
        onHoverRef.current(iso, [e.lngLat.lng, e.lngLat.lat]);
      }
    };

    const handleLeave = () => {
      map.getCanvas().style.cursor = "";
      onHoverRef.current(null, null);
    };

    map.on("click", handleClick);
    map.on("mousemove", handleMove);
    map.on("mouseleave", handleLeave);
    return () => {
      map.off("click", handleClick);
      map.off("mousemove", handleMove);
      map.off("mouseleave", handleLeave);
    };
  }, [map, isLoaded]);

  return null;
}

interface AbroadMapProps {
  electionId: string | number | undefined;
  selectedIso: string | null;
  /** Hovered country — lifted from the parent so the border
   *  highlight stays in sync with the right-side legend preview. */
  hoveredIso: string | null;
  /** Party that the user is hovering / has tapped in the legend.
   *  Matching tile cells stay at full opacity, the rest dim out —
   *  same mechanic as the Bulgaria map's party-hover highlight. */
  activeParty: string | null;
  onSelect: (iso: string | null) => void;
  /** Lifted hover state so the parent can show a preview in its
   *  right-side legend. null when the cursor is off any country. */
  onHoverChange: (iso: string | null) => void;
}

export function AbroadMap({
  electionId,
  selectedIso,
  hoveredIso,
  activeParty,
  onSelect,
  onHoverChange,
}: AbroadMapProps) {
  const { data, isLoading } = useAbroadByCountry(electionId);
  const world = useWorldCountries();

  const countries = data?.countries ?? [];

  // AbroadLayer reports `(iso, lngLat)` — the parent only needs the
  // iso code, so drop the lngLat here.
  const handleHover = (iso: string | null) => onHoverChange(iso);

  return (
    <div className="relative h-full w-full">
      <MapComponent
        // Placeholder viewport — AbroadLayer replaces this with
        // `fitBounds` on the Europe bbox as soon as the world
        // GeoJSON and the per-country aggregates are available.
        center={[16, 52]}
        zoom={3}
        minZoom={1}
        maxZoom={7}
        className="h-full w-full"
        loading={isLoading || world === null}
        styles={{ light: BLANK_STYLE as any, dark: BLANK_STYLE as any }}
        attributionControl={false}
        dragRotate={false}
        pitchWithRotate={false}
      >
        {world && world.length > 0 && countries.length > 0 && (
          <>
            <AbroadLayer
              world={world}
              countries={countries}
              selectedIso={selectedIso}
              hoveredIso={hoveredIso}
              activeParty={activeParty}
              onCountryClick={onSelect}
              onCountryHover={(iso) => handleHover(iso)}
            />
            <MapControls />
          </>
        )}
      </MapComponent>
    </div>
  );
}
