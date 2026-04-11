import { useEffect, useRef } from "react";
import type MapLibreGL from "maplibre-gl";
import { useMap } from "@/components/ui/map";
import type { SectionGeo } from "@/lib/api/types.js";
import { offsetOverlappingSections } from "./utils.js";
import { BASE_LAYER, BASE_SOURCE, CIRCLE_LAYER } from "./constants.js";

/**
 * Base layer: every section in the current election rendered as a small
 * circle filled with the winner's party colour. Sections that are also in
 * the anomaly overlay (`riskCodes`) are excluded so the triangles don't
 * stack on top of an identical circle.
 *
 * The click handler is delegated through a ref so the parent can swap the
 * `onSectionClick` callback without re-running the layer-setup effect.
 */
export function AllSectionsLayer({
  sections,
  onSectionClick,
  riskCodes,
}: {
  sections: SectionGeo[];
  onSectionClick: (sectionCode: string) => void;
  riskCodes?: Set<string>;
}) {
  const { map, isLoaded } = useMap();
  const onClickRef = useRef(onSectionClick);
  onClickRef.current = onSectionClick;

  useEffect(() => {
    if (!map || !isLoaded || sections.length === 0) return;

    const baseSections = riskCodes?.size
      ? sections.filter((s) => !riskCodes.has(s.section_code))
      : sections;
    const spread = offsetOverlappingSections(baseSections);
    const fc = {
      type: "FeatureCollection" as const,
      features: spread.map((s) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [s._lng, s._lat] },
        properties: {
          section_code: s.section_code,
          winner_color: s.winner_color,
        },
      })),
    };

    const existing = map.getSource(BASE_SOURCE);
    if (existing) {
      (existing as MapLibreGL.GeoJSONSource).setData(fc as any);
    } else {
      map.addSource(BASE_SOURCE, { type: "geojson", data: fc as any });
    }

    if (!map.getLayer(BASE_LAYER)) {
      map.addLayer({
        id: BASE_LAYER,
        type: "circle",
        source: BASE_SOURCE,
        paint: {
          "circle-radius": [
            "interpolate", ["linear"], ["zoom"],
            6, 2,
            9, 4,
            12, 7,
            15, 12,
          ],
          "circle-color": ["get", "winner_color"],
          "circle-opacity": [
            "interpolate", ["linear"], ["zoom"],
            6, 0.5,
            9, 0.7,
            12, 0.85,
          ],
          "circle-stroke-width": 0.5,
          "circle-stroke-color": "rgba(255,255,255,0.5)",
        },
      });
    }

    // Click on the base layer only fires when the anomaly layer didn't
    // catch the click — that way the triangle takes priority over the
    // circle underneath it.
    const handleClick = (e: MapLibreGL.MapMouseEvent) => {
      const riskFeatures = map.queryRenderedFeatures(e.point, {
        layers: map.getLayer(CIRCLE_LAYER) ? [CIRCLE_LAYER] : [],
      });
      if (riskFeatures.length > 0) return;

      const features = map.queryRenderedFeatures(e.point, { layers: [BASE_LAYER] });
      if (!features.length) return;
      const code = features[0].properties?.section_code;
      if (code) onClickRef.current(code);
    };

    const handleMouseMove = (e: MapLibreGL.MapMouseEvent) => {
      const features = map.queryRenderedFeatures(e.point, { layers: [BASE_LAYER] });
      map.getCanvas().style.cursor = features.length > 0 ? "pointer" : "";
    };

    map.on("click", BASE_LAYER, handleClick);
    map.on("mousemove", handleMouseMove);

    return () => {
      map.off("click", BASE_LAYER, handleClick);
      map.off("mousemove", handleMouseMove);
      try {
        if (map.getLayer(BASE_LAYER)) map.removeLayer(BASE_LAYER);
        if (map.getSource(BASE_SOURCE)) map.removeSource(BASE_SOURCE);
      } catch {
        /* map already destroyed */
      }
    };
  }, [map, isLoaded, sections, riskCodes]);

  return null;
}
