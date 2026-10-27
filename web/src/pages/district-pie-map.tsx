import { useEffect, useLayoutEffect, useState, useCallback, useMemo, useRef } from "react";
import { useParams, useSearchParams } from "react-router";
import { trackEvent } from "@/lib/analytics.js";
import { Map as MapComponent, useMap, MapControls } from "@/components/ui/map";
import MapLibreGL from "maplibre-gl";
import bbox from "@turf/bbox";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import { point as turfPoint } from "@turf/helpers";
import {
  useAbroadByCountry,
  useGeoResults,
} from "@/lib/hooks/use-geo-results.js";
import type { GeoLevel } from "@/lib/api/geo-results.js";
import type { AbroadCountry, Election, GeoArea } from "@/lib/api/types.js";
import { AbroadMap } from "@/components/map/abroad-map.js";
import { arrangeCells } from "./tile-arrangement.js";

// Local alias — district-pie-map narrows the geometry to polygon variants.
type GeoRegion = Omit<GeoArea, "geo"> & {
  geo: GeoJSON.Polygon | GeoJSON.MultiPolygon;
};


interface AggregatedParty {
  name: string;
  color: string;
  totalVotes: number;
  /** Share of all registered voters (narrative denominator — includes
   *  non-voters and "не подкрепям никого"). Used to show "only X% of
   *  Bulgarians voted for this party." */
  pctRegistered: number;
  /** Share of party votes per CIK rules — excludes non-voters AND
   *  "не подкрепям никого". This is the percentage that determines the
   *  4% parliamentary threshold. null for the non-voter and null-vote
   *  rows which by definition aren't party votes. */
  pctCik: number | null;
}

const BULGARIA_CENTER: [number, number] = [25.3, 42.7];
const BULGARIA_ZOOM = 6.9;
const NON_VOTER_COLOR = "#c0c0c0";
const TILE_SOURCE = "region-tiles";
const TILE_LAYER = "region-tiles-fill";
const BORDER_SOURCE = "region-borders";
const BORDER_LAYER = "region-borders-line";
const DISTRICT_SOURCE = "district-borders";
const DISTRICT_LAYER = "district-borders-line";
// Hovered/selected outline, drawn from the region border source and
// filtered to the focused ids: a soft shadow, a dark casing and a white
// inner line on top. Reads clearly over any tile colour without the
// harshness of a single thick black stroke.
const FOCUS_GLOW_LAYER = "region-focus-glow";
const FOCUS_CASING_LAYER = "region-focus-casing";
const FOCUS_INNER_LAYER = "region-focus-inner";
const FOCUS_LAYERS = [FOCUS_GLOW_LAYER, FOCUS_CASING_LAYER, FOCUS_INNER_LAYER];
const OTHER_COLOR = "#999";

// Municipality/МИР separators are drawn as soft white seams between
// tile fields rather than dark ink, so the tiles stay the figure and
// the borders read as gaps. Width grows with zoom: hairlines on the
// national view, a clear seam once tiles are large.
const BORDER_COLOR = "#ffffff";
const BORDER_OPACITY = 0.85;
const BORDER_WIDTH: MapLibreGL.ExpressionSpecification = [
  "interpolate", ["linear"], ["zoom"],
  6, 0.6,
  8, 1,
  11, 2,
  14, 3,
];

// Oblast outlines sit one step up the hierarchy: a soft grey line,
// slightly wider than the white seams, so the 28 districts (and the
// country's edge) stay legible without going back to dark ink.
const DISTRICT_COLOR = "#6b6b6b";
const DISTRICT_OPACITY = 0.7;
const DISTRICT_WIDTH: MapLibreGL.ExpressionSpecification = [
  "interpolate", ["linear"], ["zoom"],
  6, 1,
  8, 1.4,
  11, 2,
  14, 2.5,
];

const FOCUS_CASING_WIDTH: MapLibreGL.ExpressionSpecification = [
  "interpolate", ["linear"], ["zoom"],
  6, 3,
  11, 4.5,
  14, 6,
];
const FOCUS_INNER_WIDTH: MapLibreGL.ExpressionSpecification = [
  "interpolate", ["linear"], ["zoom"],
  6, 1,
  11, 1.5,
  14, 2,
];
const FOCUS_GLOW_WIDTH: MapLibreGL.ExpressionSpecification = [
  "interpolate", ["linear"], ["zoom"],
  6, 8,
  11, 12,
  14, 16,
];
const MIN_SHARE = 0.02;
/** Web Mercator stretches a degree of latitude by 1/cos(lat), so a
 *  0.02°×0.02° cell renders ~36% taller than wide over Bulgaria. The
 *  lattice squeezes latitude by cos(42.7°) — the country's mid-latitude —
 *  and widens longitude by the same √ so tiles read as squares on screen
 *  while the cell count (and the tile budget) stays the same. */
const TILE_ASPECT = Math.sqrt(Math.cos((42.7 * Math.PI) / 180));

const BLANK_STYLE: MapLibreGL.StyleSpecification = {
  version: 8,
  name: "blank",
  sources: {},
  layers: [
    {
      id: "background",
      type: "background",
      paint: { "background-color": "#f8f8f8" },
    },
  ],
};

function buildTileFeatures(
  region: GeoRegion,
  showNonVoters: boolean,
  gridStep: number,
  partyRank: Map<string, number>,
): GeoJSON.Feature[] {
  const geo = region.geo;
  if (!geo) return [];

  const [minX, minY, maxX, maxY] = bbox({
    type: "Feature",
    geometry: geo,
    properties: {},
  });

  // One lattice anchored at 0°/0° for every region, not one per bbox —
  // neighbouring regions' tiles line up edge to edge instead of
  // overlapping or leaving slivers of background along shared borders.
  const stepX = gridStep / TILE_ASPECT;
  const stepY = gridStep * TILE_ASPECT;
  const halfX = stepX / 2;
  const halfY = stepY / 2;
  const cells: [number, number][] = [];
  for (let i = Math.floor(minX / stepX); (i + 0.5) * stepX < maxX; i++) {
    const x = (i + 0.5) * stepX;
    if (x < minX) continue;
    for (let j = Math.floor(minY / stepY); (j + 0.5) * stepY < maxY; j++) {
      const y = (j + 0.5) * stepY;
      if (y < minY) continue;
      const pt = turfPoint([x, y]);
      if (booleanPointInPolygon(pt, geo)) {
        cells.push([x, y]);
      }
    }
  }

  if (cells.length === 0) return [];

  type Slice = { label: string; color: string; share: number };
  const slices: Slice[] = [];
  const total = showNonVoters ? region.registered_voters : region.total_votes;
  if (total <= 0) return [];

  let otherShare = 0;
  for (const p of region.parties) {
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
  if (showNonVoters) {
    const nv = region.registered_voters - region.actual_voters;
    if (nv > 0) {
      slices.push({ label: "Негласували", color: NON_VOTER_COLOR, share: nv / total });
    }
  }

  // Same block order in every region — non-voters, then parties by
  // national ranking, "Други" last — so each colour takes roughly the same
  // threshold band everywhere and the stipple continues across borders.
  const rankOf = (s: Slice) =>
    s.color === NON_VOTER_COLOR ? -1 : partyRank.get(s.label) ?? Number.MAX_VALUE;
  slices.sort((a, b) => rankOf(a) - rankOf(b) || b.share - a.share);

  const totalCells = cells.length;
  const colorAssignments: string[] = [];
  const labelAssignments: string[] = [];
  let remaining = totalCells;

  for (let i = 0; i < slices.length; i++) {
    const isLast = i === slices.length - 1;
    const count = isLast ? remaining : Math.round(slices[i].share * totalCells);
    const actual = Math.min(count, remaining);
    for (let j = 0; j < actual; j++) {
      colorAssignments.push(slices[i].color);
      labelAssignments.push(slices[i].label);
    }
    remaining -= actual;
  }

  const order = arrangeCells(cells, stepX, stepY);

  const features: GeoJSON.Feature[] = [];
  for (let i = 0; i < cells.length && i < colorAssignments.length; i++) {
    const [cx, cy] = cells[order[i]];
    features.push({
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [[[cx - halfX, cy - halfY], [cx + halfX, cy - halfY], [cx + halfX, cy + halfY], [cx - halfX, cy + halfY], [cx - halfX, cy - halfY]]],
      },
      properties: {
        region_id: region.id,
        region_name: region.name,
        color: colorAssignments[i],
        party_name: labelAssignments[i],
      },
    });
  }

  return features;
}

function getGridStep(level: GeoLevel): number {
  switch (level) {
    case "riks": return 0.025;
    case "districts": return 0.04;
    case "municipalities": return 0.02;
  }
}

/** Cheap polygon-size proxy via bbox area. Used to stack smaller regions
 *  on top of larger ones when their geometries overlap (e.g. Пловдив-град
 *  sits inside Пловдив-област; the oblast MIR's polygon includes the
 *  city area, so without z-ordering the city disappears). */
function bboxArea(r: GeoRegion): number {
  if (!r.geo) return 0;
  const [minX, minY, maxX, maxY] = bbox({ type: "Feature", geometry: r.geo, properties: {} });
  return (maxX - minX) * (maxY - minY);
}

function computeAllTiles(
  regions: GeoRegion[],
  showNonVoters: boolean,
  level: GeoLevel,
): GeoJSON.FeatureCollection {
  const step = getGridStep(level);
  // Largest bbox first → smallest renders last (on top).
  const ordered = [...regions].sort((a, b) => bboxArea(b) - bboxArea(a));
  const votesByParty = new Map<string, number>();
  for (const r of regions) {
    for (const p of r.parties) {
      votesByParty.set(p.name, (votesByParty.get(p.name) ?? 0) + p.votes);
    }
  }
  const partyRank = new Map(
    [...votesByParty].sort((a, b) => b[1] - a[1]).map(([name], i) => [name, i]),
  );
  const allFeatures: GeoJSON.Feature[] = [];
  for (const r of ordered) {
    allFeatures.push(...buildTileFeatures(r, showNonVoters, step, partyRank));
  }
  return { type: "FeatureCollection", features: allFeatures };
}

/** A party row is "counted for CIK" if it's a real party. The synthetic
 *  "не подкрепям никого" row is given party_id -1 by the server; the
 *  "Негласували" aggregate has no party_id (it's not in `region.parties`
 *  at all — we append it manually). So a party is CIK-eligible iff
 *  party_id > 0. */
function isCikEligible(partyId: number): boolean {
  return partyId > 0;
}

function aggregateParties(
  regions: GeoRegion[],
  showNonVoters: boolean,
  abroadCountries: AbroadCountry[] = [],
): AggregatedParty[] {
  const byName = new Map<
    string,
    { color: string; votes: number; partyId: number }
  >();
  let registeredTotal = 0;
  let cikTotal = 0;

  const addParty = (p: {
    party_id: number;
    name: string;
    color: string;
    votes: number;
  }) => {
    if (isCikEligible(p.party_id)) cikTotal += p.votes;
    const existing = byName.get(p.name);
    if (existing) {
      existing.votes += p.votes;
    } else {
      byName.set(p.name, {
        color: p.color || "#555",
        votes: p.votes,
        partyId: p.party_id,
      });
    }
  };

  for (const r of regions) {
    registeredTotal += r.registered_voters;
    for (const p of r.parties) addParty(p);
    if (showNonVoters) {
      const nv = r.registered_voters - r.actual_voters;
      if (nv > 0) {
        const existing = byName.get("Негласували");
        if (existing) {
          existing.votes += nv;
        } else {
          byName.set("Негласували", {
            color: NON_VOTER_COLOR,
            votes: nv,
            partyId: -2, // sentinel — not a party
          });
        }
      }
    }
  }

  // Abroad contributes to the national legend even though it renders
  // on the world-map inset, not on the Bulgaria map. Dropping it would
  // break the 4% CIK threshold because the denominator shrinks —
  // Velichie was visibly moving from 4.00 → 3.77 with abroad stripped.
  // Abroad has no "non-voter" pool: registered_voters == actual_voters
  // (pre-registration undercounts walk-ins, see server comment), so
  // there's no "Негласували" contribution.
  for (const ac of abroadCountries) {
    registeredTotal += ac.registered_voters;
    for (const p of ac.parties) addParty(p);
  }

  const result: AggregatedParty[] = [];
  for (const [name, { color, votes, partyId }] of byName) {
    result.push({
      name,
      color,
      totalVotes: votes,
      pctRegistered:
        registeredTotal > 0 ? (votes / registeredTotal) * 100 : 0,
      pctCik:
        isCikEligible(partyId) && cikTotal > 0
          ? (votes / cikTotal) * 100
          : null,
    });
  }
  result.sort((a, b) => b.totalVotes - a.totalVotes);
  return result;
}

// Map a per-country abroad aggregate onto the same AggregatedParty
// shape used by the Bulgarian legend. Abroad has no "not showed up"
// pool, so `registered` equals `actual` (see server: the protocol's
// pre-registration undercounts walk-in voters). That means the
// "Registered share" column collapses onto the CIK-rule share.
function aggregateAbroadCountryParties(country: AbroadCountry): AggregatedParty[] {
  const registeredTotal = country.registered_voters;
  const cikTotal = country.parties
    .filter((p) => p.party_id > 0)
    .reduce((sum, p) => sum + p.votes, 0);

  return country.parties.map((p) => ({
    name: p.name,
    color: p.color,
    totalVotes: p.votes,
    pctRegistered: registeredTotal > 0 ? (p.votes / registeredTotal) * 100 : 0,
    pctCik: p.party_id > 0 && cikTotal > 0 ? (p.votes / cikTotal) * 100 : null,
  }));
}

// Abroad-only national aggregate for the "Чужбина" tab default view.
// Sums every country into one party list. The Bulgaria tab uses
// aggregateParties(regions, …, abroadCountries) to merge abroad into
// the national CIK total; this one is the flip side — just abroad.
function aggregateAbroadNationalParties(
  abroadCountries: AbroadCountry[],
): AggregatedParty[] {
  const byName = new Map<
    string,
    { color: string; votes: number; partyId: number }
  >();
  let registeredTotal = 0;
  let cikTotal = 0;
  for (const ac of abroadCountries) {
    registeredTotal += ac.registered_voters;
    for (const p of ac.parties) {
      if (isCikEligible(p.party_id)) cikTotal += p.votes;
      const existing = byName.get(p.name);
      if (existing) {
        existing.votes += p.votes;
      } else {
        byName.set(p.name, {
          color: p.color || "#555",
          votes: p.votes,
          partyId: p.party_id,
        });
      }
    }
  }
  const result: AggregatedParty[] = [];
  for (const [name, { color, votes, partyId }] of byName) {
    result.push({
      name,
      color,
      totalVotes: votes,
      pctRegistered: registeredTotal > 0 ? (votes / registeredTotal) * 100 : 0,
      pctCik:
        isCikEligible(partyId) && cikTotal > 0 ? (votes / cikTotal) * 100 : null,
    });
  }
  result.sort((a, b) => b.totalVotes - a.totalVotes);
  return result;
}

// Aggregate for a single region
function aggregateRegionParties(
  region: GeoRegion,
  showNonVoters: boolean,
): AggregatedParty[] {
  const registeredTotal = region.registered_voters;
  const cikTotal = region.parties
    .filter((p) => isCikEligible(p.party_id))
    .reduce((sum, p) => sum + p.votes, 0);

  if (registeredTotal <= 0) return [];

  const result: AggregatedParty[] = [];

  for (const p of region.parties) {
    result.push({
      name: p.name,
      color: p.color || "#555",
      totalVotes: p.votes,
      pctRegistered: (p.votes / registeredTotal) * 100,
      pctCik:
        isCikEligible(p.party_id) && cikTotal > 0
          ? (p.votes / cikTotal) * 100
          : null,
    });
  }
  if (showNonVoters) {
    const nv = region.registered_voters - region.actual_voters;
    if (nv > 0) {
      result.push({
        name: "Негласували",
        color: NON_VOTER_COLOR,
        totalVotes: nv,
        pctRegistered: (nv / registeredTotal) * 100,
        pctCik: null,
      });
    }
  }

  result.sort((a, b) => b.totalVotes - a.totalVotes);
  return result;
}

// Fill-opacity levels. MapLibre only animates paint transitions between
// constant values — a data-driven `case` expression snaps instantly (see
// TransitioningPropertyValue in maplibre-gl). So instead of one layer
// with a per-feature opacity expression, the base layer carries a single
// constant opacity that dims as a whole, and a "focus" layer on top
// re-draws only the tiles that should stand out (filtered by party
// and/or region) at its own constant opacity. Both fade natively.
const TILE_OPACITY = 0.9;
// Muted tiles stay faintly visible so the surrounding mix still reads
// as context instead of vanishing to white.
const TILE_OPACITY_PARTY_DIM = 0.2;
const TILE_OPACITY_REGION_DIM = 0.18;
const FOCUS_OPACITY_PARTY = 1;
const FOCUS_OPACITY_REGION = 0.9;
// Two focus layers so switching party A → B cross-fades: A fades out on
// one layer while B fades in on the other.
const TILE_FOCUS_LAYERS = ["region-tiles-focus-a", "region-tiles-focus-b"] as const;
const FADE_MS = 250;
// Camera padding: the top inset clears the absolute-positioned controls
// row, which can wrap to two lines on narrow viewports.
const NATIONAL_PADDING = { top: 96, bottom: 32, left: 24, right: 24 };
const REGION_PADDING = { top: 112, bottom: 64, left: 64, right: 64 };
const EMPTY_FILTER: MapLibreGL.FilterSpecification = ["boolean", false];

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** Which tiles the focus layer should re-draw on top of the dimmed base.
 *  null = nothing focused, base layer at rest. */
function buildFocusFilter(
  activeParty: string | null,
  selectedRegionId: number | null,
): MapLibreGL.FilterSpecification | null {
  if (activeParty && selectedRegionId != null) {
    return ["all",
      ["==", ["get", "party_name"], activeParty],
      ["==", ["get", "region_id"], selectedRegionId],
    ];
  }
  if (activeParty) return ["==", ["get", "party_name"], activeParty];
  if (selectedRegionId != null) return ["==", ["get", "region_id"], selectedRegionId];
  return null;
}

/** Calls `cb` once a GeoJSON source has re-tiled after `setData`. The
 *  "content" sourcedata event marks the worker update; tiles finish
 *  loading on later frames, so poll isSourceLoaded on render after it.
 *  Falls back to a timeout so a missed event can't leave tiles hidden. */
function onSourceReloaded(
  map: MapLibreGL.Map,
  sourceId: string,
  cb: () => void,
): () => void {
  let sawContent = false;
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    stop();
    cb();
  };
  const onData = (e: MapLibreGL.MapSourceDataEvent) => {
    if (e.sourceId === sourceId && e.sourceDataType === "content") sawContent = true;
  };
  const onRender = () => {
    if (sawContent && map.getSource(sourceId) && map.isSourceLoaded(sourceId)) finish();
  };
  const fallback = setTimeout(finish, 1500);
  const stop = () => {
    done = true;
    clearTimeout(fallback);
    map.off("sourcedata", onData);
    map.off("render", onRender);
  };
  map.on("sourcedata", onData);
  map.on("render", onRender);
  return stop;
}

function TileDensityLayer({
  regions,
  districts,
  showNonVoters,
  geoLevel,
  activeParty,
  selectedRegionId,
  hoveredRegionId,
  onRegionClick,
  onRegionHover,
}: {
  regions: GeoRegion[];
  /** Oblast polygons drawn as a stronger outline over the region seams. */
  districts: GeoRegion[];
  showNonVoters: boolean;
  geoLevel: GeoLevel;
  activeParty: string | null;
  selectedRegionId: number | null;
  hoveredRegionId: number | null;
  onRegionClick: (regionId: number, lngLat: [number, number]) => void;
  onRegionHover: (regionId: number | null) => void;
}) {
  const { map, isLoaded } = useMap();
  const onClickRef = useRef(onRegionClick);
  onClickRef.current = onRegionClick;
  const onHoverRef = useRef(onRegionHover);
  onHoverRef.current = onRegionHover;

  const tileData = useMemo(
    () => computeAllTiles(regions, showNonVoters, geoLevel),
    [regions, showNonVoters, geoLevel],
  );

  const borderData = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: regions.map((r) => ({
        type: "Feature" as const,
        geometry: r.geo,
        properties: { id: r.id, name: r.name },
      })),
    }),
    [regions],
  );

  const districtData = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: districts.map((d) => ({
        type: "Feature" as const,
        geometry: d.geo,
        properties: { id: d.id },
      })),
    }),
    [districts],
  );

  // Fit the viewport to the full set of municipalities on first load
  // so Bulgaria is always fully in frame regardless of container size
  // (mobile portrait, desktop with legend sidebar, etc). The extra
  // top padding accounts for the absolute-positioned controls row,
  // which can wrap to two lines on narrow viewports.
  //
  // The fit is deferred with a double-rAF + explicit `map.resize()`
  // because on first mount the flex parent hasn't resolved its final
  // height yet — fitting against the stale size made Bulgaria
  // overflow the bottom once the legend sibling pushed the map
  // container shorter.
  const fittedRef = useRef(false);
  const [fitted, setFitted] = useState(false);
  const nationalBoundsRef = useRef<MapLibreGL.LngLatBoundsLike | null>(null);
  useEffect(() => {
    if (!map || !isLoaded || fittedRef.current || regions.length === 0) return;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const r of regions) {
      const [x1, y1, x2, y2] = bbox(r.geo as any);
      if (x1 < minX) minX = x1;
      if (y1 < minY) minY = y1;
      if (x2 > maxX) maxX = x2;
      if (y2 > maxY) maxY = y2;
    }
    if (!isFinite(minX)) return;
    nationalBoundsRef.current = [
      [minX, minY],
      [maxX, maxY],
    ];

    const runFit = () => {
      map.resize();
      map.fitBounds(nationalBoundsRef.current!, {
        padding: NATIONAL_PADDING,
        animate: false,
        maxZoom: 8,
      });
      fittedRef.current = true;
      setFitted(true);
    };

    let raf2: number | null = null;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(runFit);
    });
    return () => {
      cancelAnimationFrame(raf1);
      if (raf2 != null) cancelAnimationFrame(raf2);
    };
  }, [map, isLoaded, regions]);

  // Glide to the selected region, and back out to the whole country
  // when the selection clears. Waits for the initial fit so a shared
  // ?region= link flies in from the national view rather than racing
  // it. The first run (no selection yet) is a no-op.
  const flownToRef = useRef<number | null>(null);
  useEffect(() => {
    if (!map || !isLoaded || !fitted) return;
    if (flownToRef.current === selectedRegionId) return;
    flownToRef.current = selectedRegionId;
    const region =
      selectedRegionId != null ? regions.find((r) => r.id === selectedRegionId) : null;
    const duration = prefersReducedMotion() ? 0 : 700;
    if (region) {
      const [x1, y1, x2, y2] = bbox(region.geo as any);
      map.fitBounds(
        [
          [x1, y1],
          [x2, y2],
        ],
        { padding: REGION_PADDING, maxZoom: 9, duration },
      );
    } else if (nationalBoundsRef.current) {
      map.fitBounds(nationalBoundsRef.current, {
        padding: NATIONAL_PADDING,
        maxZoom: 8,
        duration,
      });
    }
  }, [map, isLoaded, fitted, selectedRegionId, regions]);

  // Paint state for the base + focus layers lives in refs so the fade
  // timers below always act on the latest target, not a stale closure.
  // `visibleRef` is false while tiles are being swapped (first load,
  // Негласували toggle, data change) so the whole layer fades out → in.
  const visibleRef = useRef(false);
  const paintTargetRef = useRef({ activeParty, selectedRegionId });
  paintTargetRef.current = { activeParty, selectedRegionId };
  const focusRef = useRef<{ idx: number; key: string | null }>({ idx: 0, key: null });
  const focusClearTimers = useRef<(ReturnType<typeof setTimeout> | undefined)[]>([]);

  const applyPaint = useCallback(() => {
    if (!map || !map.getLayer(TILE_LAYER)) return;
    const { activeParty: party, selectedRegionId: regionId } = paintTargetRef.current;
    const visible = visibleRef.current;
    const baseOpacity = !visible
      ? 0
      : party
        ? TILE_OPACITY_PARTY_DIM
        : regionId != null
          ? TILE_OPACITY_REGION_DIM
          : TILE_OPACITY;
    map.setPaintProperty(TILE_LAYER, "fill-opacity", baseOpacity);
    if (visible && map.getLayer(BORDER_LAYER)) {
      map.setPaintProperty(BORDER_LAYER, "line-opacity", BORDER_OPACITY);
    }

    const filter = buildFocusFilter(party, regionId);
    const key = filter ? JSON.stringify(filter) : null;
    const focusOpacity = !visible ? 0 : party ? FOCUS_OPACITY_PARTY : FOCUS_OPACITY_REGION;
    const focus = focusRef.current;
    if (key === focus.key) {
      if (key) map.setPaintProperty(TILE_FOCUS_LAYERS[focus.idx], "fill-opacity", focusOpacity);
      return;
    }
    // Outgoing focus fades out but keeps its filter until it's gone,
    // then the filter is emptied so the layer is clean for reuse.
    if (focus.key) {
      const outIdx = focus.idx;
      map.setPaintProperty(TILE_FOCUS_LAYERS[outIdx], "fill-opacity", 0);
      clearTimeout(focusClearTimers.current[outIdx]);
      focusClearTimers.current[outIdx] = setTimeout(() => {
        if (map.getLayer(TILE_FOCUS_LAYERS[outIdx])) {
          map.setFilter(TILE_FOCUS_LAYERS[outIdx], EMPTY_FILTER);
        }
      }, FADE_MS + 50);
    }
    let idx = focus.idx;
    if (filter) {
      idx = focus.key ? 1 - focus.idx : focus.idx;
      clearTimeout(focusClearTimers.current[idx]);
      map.setFilter(TILE_FOCUS_LAYERS[idx], filter);
      map.setPaintProperty(TILE_FOCUS_LAYERS[idx], "fill-opacity", focusOpacity);
    }
    focusRef.current = { idx, key };
  }, [map]);

  useEffect(() => {
    if (!isLoaded) return;
    applyPaint();
  }, [isLoaded, applyPaint, activeParty, selectedRegionId]);

  // Source + layers are created once per map; data changes go through
  // setData so the layer keeps its paint state (and its place below the
  // border layer) instead of being torn down and re-added.
  useEffect(() => {
    if (!map || !isLoaded) return;
    const transition = { duration: prefersReducedMotion() ? 0 : FADE_MS, delay: 0 };
    const beforeId = map.getLayer(BORDER_LAYER) ? BORDER_LAYER : undefined;
    map.addSource(TILE_SOURCE, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
    map.addLayer(
      {
        id: TILE_LAYER,
        type: "fill",
        source: TILE_SOURCE,
        paint: {
          "fill-color": ["get", "color"],
          "fill-opacity": 0,
          "fill-opacity-transition": transition,
        },
      },
      beforeId,
    );
    for (const id of TILE_FOCUS_LAYERS) {
      map.addLayer(
        {
          id,
          type: "fill",
          source: TILE_SOURCE,
          filter: EMPTY_FILTER,
          paint: {
            "fill-color": ["get", "color"],
            "fill-opacity": 0,
            "fill-opacity-transition": transition,
          },
        },
        beforeId,
      );
    }
    const timers = focusClearTimers.current;
    return () => {
      timers.forEach((t) => clearTimeout(t));
      visibleRef.current = false;
      focusRef.current = { idx: 0, key: null };
      try {
        for (const id of [...TILE_FOCUS_LAYERS, TILE_LAYER]) {
          if (map.getLayer(id)) map.removeLayer(id);
        }
        if (map.getSource(TILE_SOURCE)) map.removeSource(TILE_SOURCE);
      } catch { /* destroyed */ }
    };
  }, [map, isLoaded]);

  // Swap tile data with a dip: fade the old tiles out while the worker
  // re-tiles the new data, then fade back in once both are done. Waiting
  // for the reload matters — fading in against the old tiles would make
  // the new ones pop in partway through. Under reduced motion the old
  // tiles simply stay until the new ones replace them.
  useEffect(() => {
    if (!map || !isLoaded) return;
    const source = map.getSource(TILE_SOURCE) as MapLibreGL.GeoJSONSource | undefined;
    if (!source) return;
    const wasVisible = visibleRef.current;
    if (wasVisible && prefersReducedMotion()) {
      source.setData(tileData as any);
      return;
    }
    visibleRef.current = false;
    applyPaint();
    source.setData(tileData as any);
    let reloaded = false;
    let fadedOut = !wasVisible;
    const show = () => {
      if (!reloaded || !fadedOut) return;
      visibleRef.current = true;
      applyPaint();
    };
    const stopWaiting = onSourceReloaded(map, TILE_SOURCE, () => {
      reloaded = true;
      show();
    });
    const timer = wasVisible
      ? setTimeout(() => {
          fadedOut = true;
          show();
        }, FADE_MS)
      : undefined;
    return () => {
      clearTimeout(timer);
      stopWaiting();
    };
  }, [map, isLoaded, tileData, applyPaint]);

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
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": BORDER_COLOR,
          "line-width": BORDER_WIDTH,
          // Seams fade in with the first tiles instead of popping in
          // ahead of them; later tile swaps leave them at rest opacity.
          "line-opacity": visibleRef.current ? BORDER_OPACITY : 0,
          "line-opacity-transition": {
            duration: prefersReducedMotion() ? 0 : FADE_MS,
            delay: 0,
          },
          "line-blur": 0.3,
        },
      // Keep the region seams under the oblast outlines when the region
      // set changes (tab switch) and this layer is re-added.
      }, map.getLayer(DISTRICT_LAYER) ? DISTRICT_LAYER : undefined);

      const none: MapLibreGL.FilterSpecification = ["==", ["get", "id"], -1];
      const lineLayout = { "line-join": "round", "line-cap": "round" } as const;
      map.addLayer({
        id: FOCUS_GLOW_LAYER,
        type: "line",
        source: BORDER_SOURCE,
        filter: none,
        layout: lineLayout,
        paint: {
          "line-color": "#000",
          "line-width": FOCUS_GLOW_WIDTH,
          "line-blur": 6,
          "line-opacity": 0.12,
        },
      });
      map.addLayer({
        id: FOCUS_CASING_LAYER,
        type: "line",
        source: BORDER_SOURCE,
        filter: none,
        layout: lineLayout,
        paint: {
          "line-color": "#1a1a1a",
          "line-width": FOCUS_CASING_WIDTH,
          "line-opacity": 0.85,
        },
      });
      map.addLayer({
        id: FOCUS_INNER_LAYER,
        type: "line",
        source: BORDER_SOURCE,
        filter: none,
        layout: lineLayout,
        paint: {
          "line-color": "#ffffff",
          "line-width": FOCUS_INNER_WIDTH,
        },
      });
    }

    return () => {
      try {
        for (const id of FOCUS_LAYERS) {
          if (map.getLayer(id)) map.removeLayer(id);
        }
        if (map.getLayer(BORDER_LAYER)) map.removeLayer(BORDER_LAYER);
        if (map.getSource(BORDER_SOURCE)) map.removeSource(BORDER_SOURCE);
      } catch { /* destroyed */ }
    };
  }, [map, isLoaded, borderData]);

  useEffect(() => {
    if (!map || !isLoaded) return;

    const existing = map.getSource(DISTRICT_SOURCE);
    if (existing) {
      (existing as MapLibreGL.GeoJSONSource).setData(districtData as any);
    } else {
      map.addSource(DISTRICT_SOURCE, { type: "geojson", data: districtData as any });
      map.addLayer({
        id: DISTRICT_LAYER,
        type: "line",
        source: DISTRICT_SOURCE,
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": DISTRICT_COLOR,
          "line-width": DISTRICT_WIDTH,
          "line-opacity": DISTRICT_OPACITY,
          "line-blur": 0.3,
        },
      }, map.getLayer(FOCUS_GLOW_LAYER) ? FOCUS_GLOW_LAYER : undefined);
    }

    return () => {
      try {
        if (map.getLayer(DISTRICT_LAYER)) map.removeLayer(DISTRICT_LAYER);
        if (map.getSource(DISTRICT_SOURCE)) map.removeSource(DISTRICT_SOURCE);
      } catch { /* destroyed */ }
    };
  }, [map, isLoaded, districtData]);

  // Highlight the hovered municipality's outline so the user can see
  // *where* the tooltip data lives, even while mousing over tiles far
  // from the boundary. The selected region keeps the full outline; a
  // hovered one gets a lighter casing so the two stay distinguishable.
  useEffect(() => {
    if (!map || !isLoaded || !map.getLayer(FOCUS_CASING_LAYER)) return;
    const ids = [hoveredRegionId, selectedRegionId].filter(
      (id): id is number => id != null,
    );
    const filter: MapLibreGL.FilterSpecification = [
      "in", ["get", "id"], ["literal", ids],
    ];
    for (const id of FOCUS_LAYERS) map.setFilter(id, filter);
    const isSelected: MapLibreGL.ExpressionSpecification = [
      "==", ["get", "id"], selectedRegionId ?? -1,
    ];
    map.setPaintProperty(FOCUS_CASING_LAYER, "line-color", [
      "case", isSelected, "#1a1a1a", "#4a4a4a",
    ]);
    map.setPaintProperty(FOCUS_CASING_LAYER, "line-opacity", [
      "case", isSelected, 0.85, 0.7,
    ]);
  }, [map, isLoaded, borderData, hoveredRegionId, selectedRegionId]);

  useEffect(() => {
    if (!map || !isLoaded) return;

    const handleClick = (e: MapLibreGL.MapMouseEvent) => {
      const features = map.queryRenderedFeatures(e.point, { layers: [TILE_LAYER] });
      if (!features.length) return;
      const regionId = features[0].properties?.region_id;
      if (regionId != null) {
        onClickRef.current(regionId, [e.lngLat.lng, e.lngLat.lat]);
      }
    };

    const handleEnter = () => { map.getCanvas().style.cursor = "pointer"; };
    const handleLeave = () => {
      map.getCanvas().style.cursor = "";
      onHoverRef.current(null);
    };

    const handleMove = (e: MapLibreGL.MapLayerMouseEvent) => {
      const regionId = e.features?.[0]?.properties?.region_id;
      if (typeof regionId === "number") onHoverRef.current(regionId);
    };

    map.on("click", TILE_LAYER, handleClick);
    map.on("mouseenter", TILE_LAYER, handleEnter);
    map.on("mouseleave", TILE_LAYER, handleLeave);
    map.on("mousemove", TILE_LAYER, handleMove);

    // Click on empty space clears region selection
    map.on("click", (e: MapLibreGL.MapMouseEvent) => {
      const features = map.queryRenderedFeatures(e.point, { layers: [TILE_LAYER] });
      if (!features.length) {
        onClickRef.current(-1, [e.lngLat.lng, e.lngLat.lat]);
      }
    });

    return () => {
      map.off("click", TILE_LAYER, handleClick);
      map.off("mouseenter", TILE_LAYER, handleEnter);
      map.off("mouseleave", TILE_LAYER, handleLeave);
      map.off("mousemove", TILE_LAYER, handleMove);
    };
  }, [map, isLoaded]);

  return null;
}

interface LegendStats {
  registered: number;
  actual: number;
  turnoutPct: number;
}

/** Thin share bar under a legend row. Width changes (switching region,
 *  hover preview) are animated with WAAPI from whatever width is on
 *  screen right now, rather than a CSS transition: React moves keyed rows
 *  in the DOM when the sort order changes, and a moved element loses its
 *  CSS transition. Starting from the computed width also keeps rapid
 *  hover-scrubbing continuous instead of restarting from a stale value. */
function ShareBar({ pct, color }: { pct: number; color: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const prevWidth = useRef<string | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const from = prevWidth.current;
    const to = `${pct}%`;
    if (from != null && from !== to && !prefersReducedMotion()) {
      // Mid-animation, the computed width is the on-screen one; at rest
      // it's already the new target, so fall back to the last target.
      const running = el.getAnimations();
      const start = running.length > 0 ? getComputedStyle(el).width : from;
      running.forEach((a) => a.cancel());
      el.animate([{ width: start }, { width: to }], {
        duration: 350,
        easing: "cubic-bezier(0.22, 1, 0.36, 1)",
      });
    }
    prevWidth.current = to;
  }, [pct]);
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute right-2 bottom-0.5 left-[26px] h-0.5 overflow-hidden rounded-full"
    >
      <span
        ref={ref}
        className="block h-full rounded-full opacity-80"
        style={{ width: `${pct}%`, background: color }}
      />
    </span>
  );
}

function PartyLegend({
  parties,
  title,
  stats,
  activeParty,
  tappedParty,
  interactive,
  canClear,
  onHover,
  onTap,
  onClear,
}: {
  parties: AggregatedParty[];
  title: string | null;
  stats: LegendStats;
  activeParty: string | null;
  tappedParty: string | null;
  /** When false, party-row hover/tap does nothing and there's no
   *  hover affordance. Used for the read-only map-hover preview. */
  interactive: boolean;
  /** Whether to render the × clear button. True iff something is
   *  actually locked in (a selected region/country). */
  canClear: boolean;
  onHover: (name: string | null) => void;
  onTap: (name: string) => void;
  onClear: () => void;
}) {
  return (
    <div className="flex h-full w-full flex-col overflow-y-auto bg-background">
      <div className="sticky top-0 z-10 border-b bg-background px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <span className="min-w-0 truncate text-sm font-medium">
            {title ?? "Всички региони"}
          </span>
          {canClear && (
            <button
              onClick={onClear}
              className="shrink-0 text-2xs text-muted-foreground hover:text-foreground"
            >
              ✕
            </button>
          )}
        </div>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-2xs tabular-nums text-muted-foreground">
          <span>{stats.registered.toLocaleString("bg-BG")} рег.</span>
          <span>{stats.actual.toLocaleString("bg-BG")} гл.</span>
          <span className="font-medium text-foreground">{stats.turnoutPct.toFixed(2)}%</span>
        </div>
      </div>
      <div className="min-h-0 flex-1 p-1">
        {parties.map((p) => {
          const isActive = activeParty === p.name;
          const isMuted = activeParty != null && !isActive;
          const isTapped = tappedParty === p.name;
          const rowClass = interactive
            ? `${isActive ? "bg-muted" : "hover:bg-muted/40"} cursor-pointer`
            : "cursor-default";
          return (
            <button
              key={p.name}
              type="button"
              disabled={!interactive}
              onClick={interactive ? () => onTap(p.name) : undefined}
              onMouseEnter={interactive ? () => onHover(p.name) : undefined}
              onMouseLeave={interactive ? () => onHover(null) : undefined}
              className={`relative flex w-full items-center gap-2 rounded px-2 pt-1 pb-1.5 text-left transition-opacity duration-200 ease-out ${rowClass} ${
                isMuted ? "opacity-35" : ""
              }`}
            >
              <span
                className={`inline-block h-2.5 w-2.5 shrink-0 rounded-sm ${isTapped ? "ring-1 ring-foreground ring-offset-1" : ""}`}
                style={{ background: p.color }}
              />
              <span className="min-w-0 flex-1 truncate text-xs">
                {p.name}
              </span>
              <span
                className="shrink-0 text-2xs tabular-nums text-muted-foreground"
                title="Брой гласове за тази опция"
              >
                {p.totalVotes.toLocaleString("bg-BG")}
              </span>
              <span
                className="w-11 shrink-0 text-right text-2xs tabular-nums text-muted-foreground/60"
                title="Дял от всички избиратели в списъка (включва негласували). Показва колко от общо избирателите са гласували за тази опция."
              >
                {p.pctRegistered.toFixed(2)}%
              </span>
              <span
                className="w-12 shrink-0 text-right text-2xs font-medium tabular-nums text-foreground"
                title="Дял от гласовете за партии по правилата на ЦИК: изключва негласувалите и 'не подкрепям никого'. Това е процентът, по който се определя 4% праг за парламента."
              >
                {p.pctCik !== null ? `${p.pctCik.toFixed(2)}%` : "—"}
              </span>
              {/* The bar draws the bold CIK share, so rows without one
                  (Негласували, не подкрепям никого) get no bar. */}
              {p.pctCik !== null && <ShareBar pct={p.pctCik} color={p.color} />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function DistrictPieMap() {
  const { electionId } = useParams<{ electionId: string }>();

  const [searchParams, setSearchParams] = useSearchParams();
  // Tab state lives in the URL (`?tab=mir|abroad`) so each view is
  // directly shareable. Defaults to "bg" (municipalities) when missing.
  const rawTab = searchParams.get("tab");
  const tab: "mir" | "bg" | "abroad" =
    rawTab === "abroad" ? "abroad" : rawTab === "mir" ? "mir" : "bg";

  // Read initial state from URL params so shared links preserve context
  const initialRegionId = searchParams.get("region");
  const initialNonVoters = searchParams.get("nonVoters");

  const [showNonVoters, setShowNonVoters] = useState(
    initialNonVoters === "0" ? false : true,
  );
  const geoLevel: GeoLevel = tab === "mir" ? "riks" : "municipalities";
  const [selectedRegion, setSelectedRegion] = useState<GeoRegion | null>(null);
  const [pendingRegionId] = useState<number | null>(
    initialRegionId ? Number(initialRegionId) : null,
  );
  const [selectedIsoCountry, setSelectedIsoCountry] = useState<string | null>(
    null,
  );
  const [hoveredRegionId, setHoveredRegionId] = useState<number | null>(null);
  const [hoveredIsoCountry, setHoveredIsoCountry] = useState<string | null>(
    null,
  );
  const [hoveredParty, setHoveredParty] = useState<string | null>(null);
  const [tappedParty, setTappedParty] = useState<string | null>(null);

  // Active party = hover takes priority over tap
  const activeParty = hoveredParty ?? tappedParty;

  const {
    data: geoData,
    isLoading: loading,
    error: queryError,
  } = useGeoResults(electionId, geoLevel);
  const { data: abroadData } = useAbroadByCountry(electionId);
  const election: Election | null = geoData?.election ?? null;
  const regions: GeoRegion[] = (geoData?.areas ?? []) as GeoRegion[];
  // Oblast outlines for the border hierarchy. Shared React Query cache
  // key with any other districts view, so it's fetched once per election.
  const { data: districtGeo } = useGeoResults(electionId, "districts");
  const districts: GeoRegion[] = (districtGeo?.areas ?? []) as GeoRegion[];
  const abroadCountries: AbroadCountry[] = abroadData?.countries ?? [];
  const error = queryError instanceof Error ? queryError.message : null;
  const isLocalElection = election?.type.startsWith("local_") ?? false;

  // Reset transient selection state whenever the underlying dataset changes.
  useEffect(() => {
    setSelectedRegion(null);
    setSelectedIsoCountry(null);
    setHoveredRegionId(null);
    setHoveredIsoCountry(null);
    setHoveredParty(null);
    setTappedParty(null);
  }, [electionId, geoLevel]);

  const regionMap = useMemo(
    () => new globalThis.Map(regions.map((r) => [r.id, r])),
    [regions],
  );

  // Restore region selection from URL param once data loads
  useEffect(() => {
    if (pendingRegionId != null && regions.length > 0 && !selectedRegion) {
      const region = regionMap.get(pendingRegionId);
      if (region) setSelectedRegion(region);
    }
  }, [pendingRegionId, regions, regionMap, selectedRegion]);

  // Sync selection state back to URL for sharing
  useEffect(() => {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        if (selectedRegion) params.set("region", String(selectedRegion.id));
        else params.delete("region");
        if (!showNonVoters) params.set("nonVoters", "0");
        else params.delete("nonVoters");
        return params;
      },
      { replace: true },
    );
  }, [selectedRegion, showNonVoters, setSearchParams]);

  const hoveredRegion = useMemo(
    () => (hoveredRegionId != null ? regionMap.get(hoveredRegionId) ?? null : null),
    [hoveredRegionId, regionMap],
  );

  const hoveredCountry = useMemo(
    () =>
      hoveredIsoCountry
        ? abroadCountries.find((c) => c.iso2 === hoveredIsoCountry) ?? null
        : null,
    [hoveredIsoCountry, abroadCountries],
  );

  // National-level or region-level party list
  const nationalParties = useMemo(
    () => aggregateParties(regions, showNonVoters, abroadCountries),
    [regions, showNonVoters, abroadCountries],
  );

  const regionParties = useMemo(
    () => selectedRegion ? aggregateRegionParties(selectedRegion, showNonVoters) : null,
    [selectedRegion, showNonVoters],
  );

  const selectedCountry = useMemo(
    () =>
      selectedIsoCountry
        ? abroadCountries.find((c) => c.iso2 === selectedIsoCountry) ?? null
        : null,
    [selectedIsoCountry, abroadCountries],
  );

  const countryParties = useMemo(
    () => (selectedCountry ? aggregateAbroadCountryParties(selectedCountry) : null),
    [selectedCountry],
  );

  // Hover previews — same shape as the "selected" aggregates but
  // only used when nothing is clicked/locked.
  const hoveredRegionParties = useMemo(
    () =>
      hoveredRegion ? aggregateRegionParties(hoveredRegion, showNonVoters) : null,
    [hoveredRegion, showNonVoters],
  );

  const hoveredCountryParties = useMemo(
    () => (hoveredCountry ? aggregateAbroadCountryParties(hoveredCountry) : null),
    [hoveredCountry],
  );

  // A map hover is previewed in the legend only when nothing is
  // locked in. Selection always wins. In preview mode the legend is
  // rendered non-interactively: no party-tap, no hover highlighting
  // of tiles, because the user is driving the state with the cursor
  // over the map, not the legend.
  const isHoverPreview =
    !selectedRegion &&
    !selectedCountry &&
    (hoveredRegion != null || hoveredCountry != null);

  // National aggregate for the Abroad tab (sum across all countries).
  // The Bulgaria tab uses `nationalParties` which already merges abroad
  // into the CIK denominator (see aggregateParties).
  const abroadNationalParties = useMemo(
    () => aggregateAbroadNationalParties(abroadCountries),
    [abroadCountries],
  );

  const legendParties = useMemo(() => {
    // Priority: selected > hovered > tab default.
    if (countryParties) return countryParties;
    if (regionParties) return regionParties;
    if (hoveredCountryParties) return hoveredCountryParties;
    if (hoveredRegionParties) return hoveredRegionParties;
    return tab === "abroad" ? abroadNationalParties : nationalParties;
  }, [
    countryParties,
    regionParties,
    hoveredCountryParties,
    hoveredRegionParties,
    tab,
    abroadNationalParties,
    nationalParties,
  ]);

  const legendTitle =
    selectedCountry?.name ??
    selectedRegion?.name ??
    hoveredCountry?.name ??
    hoveredRegion?.name ??
    (tab === "abroad" ? "Всички държави" : null);

  const legendStats = useMemo((): LegendStats => {
    if (selectedCountry) {
      return {
        registered: selectedCountry.registered_voters,
        actual: selectedCountry.actual_voters,
        turnoutPct: 100, // abroad has no meaningful "not showed up" pool
      };
    }
    if (selectedRegion) {
      const registered = selectedRegion.registered_voters;
      const actual = selectedRegion.actual_voters;
      return {
        registered,
        actual,
        turnoutPct: registered > 0 ? (actual / registered) * 100 : 0,
      };
    }
    if (hoveredCountry) {
      return {
        registered: hoveredCountry.registered_voters,
        actual: hoveredCountry.actual_voters,
        turnoutPct: 100,
      };
    }
    if (hoveredRegion) {
      const registered = hoveredRegion.registered_voters;
      const actual = hoveredRegion.actual_voters;
      return {
        registered,
        actual,
        turnoutPct: registered > 0 ? (actual / registered) * 100 : 0,
      };
    }
    if (tab === "abroad") {
      let registered = 0;
      let actual = 0;
      for (const ac of abroadCountries) {
        registered += ac.registered_voters;
        actual += ac.actual_voters;
      }
      return {
        registered,
        actual,
        turnoutPct: 100,
      };
    }
    // Bulgaria tab national: match CIK's "Обобщена активност на гласуване
    // за страната" formula — numerator sums voters from every section
    // (domestic + abroad), denominator is the domestic pre-election list
    // only. Abroad has no meaningful registered count: voters walk in
    // and the reported `registered_voters` there is a tiny placeholder
    // (≈60k for pe202604 vs ≈200k actual voters). Including it in the
    // denominator drags the headline figure ~0.4 pp below CIK's.
    let registered = 0;
    let actual = 0;
    for (const r of regions) {
      registered += r.registered_voters;
      actual += r.actual_voters;
    }
    for (const ac of abroadCountries) {
      actual += ac.actual_voters;
    }
    return {
      registered,
      actual,
      turnoutPct: registered > 0 ? (actual / registered) * 100 : 0,
    };
  }, [
    regions,
    selectedRegion,
    selectedCountry,
    hoveredRegion,
    hoveredCountry,
    abroadCountries,
    tab,
  ]);

  const handleRegionClick = useCallback(
    (regionId: number, _lngLat: [number, number]) => {
      if (regionId === -1) {
        // Click on empty space
        setSelectedRegion(null);
        return;
      }
      const region = regionMap.get(regionId);
      if (!region) return;
      const isSelecting = region.id !== undefined;
      if (isSelecting) trackEvent("click_region", { region_id: regionId, region_name: region.name, election_id: electionId });
      setSelectedRegion((prev) => prev?.id === regionId ? null : region);
      setSelectedIsoCountry(null);
      setTappedParty(null);
    },
    [regionMap, electionId],
  );

  const handleCountrySelect = useCallback(
    (iso: string | null) => {
      if (iso) {
        trackEvent("click_abroad_country", { iso2: iso, election_id: electionId });
      }
      setSelectedIsoCountry((prev) => (prev === iso ? null : iso));
      setSelectedRegion(null);
      setTappedParty(null);
    },
    [electionId],
  );

  const handlePartyTap = useCallback((name: string) => {
    trackEvent("tap_party", { party_name: name, election_id: electionId });
    setTappedParty((prev) => prev === name ? null : name);
  }, [electionId]);

  const handleClear = useCallback(() => {
    setSelectedRegion(null);
    setSelectedIsoCountry(null);
    setTappedParty(null);
    setHoveredParty(null);
  }, []);

  const handleTabChange = useCallback(
    (next: "mir" | "bg" | "abroad") => {
      if (next === tab) return;
      trackEvent("switch_results_tab", { tab: next, election_id: electionId });
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          if (next === "bg") params.delete("tab");
          else params.set("tab", next);
          return params;
        },
        { replace: false },
      );
      setSelectedRegion(null);
      setSelectedIsoCountry(null);
      setHoveredRegionId(null);
      setHoveredIsoCountry(null);
      setTappedParty(null);
      setHoveredParty(null);
    },
    [tab, electionId, setSearchParams],
  );

  if (isLocalElection) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="rounded-md border bg-background px-6 py-4 text-center shadow-sm">
          <div className="text-sm font-medium">Местни избори</div>
          <div className="mt-1 text-xs text-muted-foreground">
            Резултатите от местните избори все още не са налични в тази визуализация.
            <br />
            Използвайте Секции или Таблица за достъп до данните.
          </div>
        </div>
      </div>
    );
  }

  return (
    // Flex layout: map fills the remaining space, legend is a sibling
    // panel (not an overlay). On mobile the two stack vertically; the
    // legend is capped at ~45vh with internal scroll so the map stays
    // usable. On ≥md it's a 320px column on the right.
    //
    // If the legend height feels cramped on small phones we can swap
    // the mobile layout for a collapsible bottom-sheet: wrap the
    // <aside> in a controlled `collapsed` state and toggle between
    // `h-10` (just the title bar) and `max-h-[45vh]` on a chevron tap.
    <div className="flex h-full w-full flex-col">
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <div className="relative min-h-0 flex-1">
          {/* Top-left controls — still overlaid on the map */}
        <div className="absolute top-2 left-2 z-10 flex flex-wrap items-center gap-1.5 md:top-3 md:left-3 md:gap-2">
          {/* Tab switcher — МИР / Общини / Чужбина */}
          <div className="inline-flex overflow-hidden rounded-md border bg-background/95 shadow-md backdrop-blur-sm">
            <button
              type="button"
              onClick={() => handleTabChange("mir")}
              className={`px-3 py-2 text-xs transition-colors ${
                tab === "mir"
                  ? "bg-foreground text-background"
                  : "text-foreground hover:bg-muted/40"
              }`}
            >
              МИР
            </button>
            <button
              type="button"
              onClick={() => handleTabChange("bg")}
              className={`border-l px-3 py-2 text-xs transition-colors ${
                tab === "bg"
                  ? "bg-foreground text-background"
                  : "text-foreground hover:bg-muted/40"
              }`}
            >
              Общини
            </button>
            <button
              type="button"
              onClick={() => handleTabChange("abroad")}
              className={`border-l px-3 py-2 text-xs transition-colors ${
                tab === "abroad"
                  ? "bg-foreground text-background"
                  : "text-foreground hover:bg-muted/40"
              }`}
            >
              Чужбина
            </button>
          </div>

          {loading && !election && (
            <div className="rounded-md border bg-background/95 px-3 py-2 shadow-md backdrop-blur-sm">
              <span className="text-xs text-muted-foreground">Зареждане...</span>
            </div>
          )}
          {error && (
            <div className="rounded-md border bg-background/95 px-3 py-2 shadow-md backdrop-blur-sm">
              <span className="text-xs text-score-high">{error}</span>
            </div>
          )}
          {tab !== "abroad" && (
            <label className="flex cursor-pointer items-center gap-1.5 rounded-md border bg-background/95 px-3 py-2 text-xs shadow-md backdrop-blur-sm">
              <input
                type="checkbox"
                checked={showNonVoters}
                onChange={(e) => setShowNonVoters(e.target.checked)}
                className="accent-primary"
              />
              Негласували
            </label>
          )}
        </div>

        {/* Map — swap full canvas between Bulgaria and world */}
        {tab !== "abroad" ? (
          <MapComponent
            center={BULGARIA_CENTER}
            zoom={BULGARIA_ZOOM}
            className="h-full w-full"
            loading={loading}
            styles={{ light: BLANK_STYLE as any, dark: BLANK_STYLE as any }}
          >
            {regions.length > 0 && (
              <>
                <TileDensityLayer
                  regions={regions}
                  districts={districts}
                  showNonVoters={showNonVoters}
                  geoLevel={geoLevel}
                  activeParty={activeParty}
                  selectedRegionId={selectedRegion?.id ?? null}
                  hoveredRegionId={hoveredRegionId}
                  onRegionClick={handleRegionClick}
                  onRegionHover={setHoveredRegionId}
                />
                <MapControls />
              </>
            )}
          </MapComponent>
        ) : (
          <AbroadMap
            electionId={electionId}
            selectedIso={selectedIsoCountry}
            hoveredIso={hoveredIsoCountry}
            activeParty={isHoverPreview ? null : activeParty}
            onSelect={handleCountrySelect}
            onHoverChange={setHoveredIsoCountry}
          />
        )}
      </div>

      {/* Right-side legend panel. Sibling of the map, so the map's
          effective width is viewport − 320px on desktop and the
          country polygons never get clipped behind a popup. */}
      {legendParties.length > 0 && (
        <aside className="flex max-h-[45vh] w-full shrink-0 flex-col border-t md:max-h-none md:h-full md:w-80 md:border-l md:border-t-0">
          <PartyLegend
            parties={legendParties}
            title={legendTitle}
            stats={legendStats}
            activeParty={isHoverPreview ? null : activeParty}
            tappedParty={isHoverPreview ? null : tappedParty}
            interactive={!isHoverPreview}
            canClear={selectedRegion != null || selectedIsoCountry != null}
            onHover={setHoveredParty}
            onTap={handlePartyTap}
            onClear={handleClear}
          />
        </aside>
      )}
      </div>
    </div>
  );
}
