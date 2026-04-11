import { useEffect, useRef } from "react";
import type MapLibreGL from "maplibre-gl";
import { useMap } from "@/components/ui/map";
import type { AnomalyMethodology, AnomalySection } from "@/lib/api/types.js";
import { buildCircleFeatures, ensureWarningIcon } from "./utils.js";
import {
  CIRCLE_HOVER_LAYER,
  CIRCLE_LAYER,
  CIRCLE_SOURCE,
  WARNING_ICON,
} from "./constants.js";

/**
 * Anomaly markers: rounded square filled with the winner party's colour,
 * plus a white "!" glyph rendered on top by MapLibre's text engine. The
 * square is an SDF icon so `icon-color` can pick up the party colour per
 * feature; the exclamation lives on the same symbol layer via `text-field`
 * so both travel together.
 *
 * Two layers share one source: a base layer and a hidden hover layer
 * filtered to one section_code at a time, so hovering a marker enlarges
 * it without re-rendering the source.
 */
export function AnomalyCirclesLayer({
  sections,
  methodology,
  colorByCode,
}: {
  sections: AnomalySection[];
  methodology: AnomalyMethodology;
  colorByCode: Map<string, string>;
}) {
  const { map, isLoaded } = useMap();
  const hoveredIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!map || !isLoaded || sections.length === 0) return;

    ensureWarningIcon(map);
    const fc = buildCircleFeatures(sections, methodology, colorByCode);

    const existing = map.getSource(CIRCLE_SOURCE);
    if (existing) {
      (existing as MapLibreGL.GeoJSONSource).setData(fc as any);
    } else {
      map.addSource(CIRCLE_SOURCE, { type: "geojson", data: fc as any });
    }

    if (!map.getLayer(CIRCLE_LAYER)) {
      map.addLayer({
        id: CIRCLE_LAYER,
        type: "symbol",
        source: CIRCLE_SOURCE,
        layout: {
          "icon-image": WARNING_ICON,
          "icon-size": [
            "interpolate", ["linear"], ["zoom"],
            6, 0.08,
            9, 0.12,
            12, 0.2,
            15, 0.3,
          ],
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
          "text-field": "!",
          "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
          "text-size": [
            "interpolate", ["linear"], ["zoom"],
            9, 9,
            12, 14,
            15, 20,
          ],
          "text-anchor": "center",
          "text-allow-overlap": true,
          "text-ignore-placement": true,
        },
        paint: {
          "icon-color": ["get", "winner_color"],
          "icon-halo-color": "rgba(255,255,255,0.75)",
          "icon-halo-width": [
            "interpolate", ["linear"], ["zoom"],
            6, 0.4,
            9, 0.6,
            12, 0.85,
            15, 1.0,
          ],
          "icon-opacity": [
            "interpolate", ["linear"], ["zoom"],
            6, 0.85,
            9, 0.95,
            12, 1.0,
          ],
          "text-color": "#ffffff",
          "text-halo-color": "rgba(0,0,0,0.7)",
          "text-halo-width": 1,
          "text-opacity": [
            "interpolate", ["linear"], ["zoom"],
            9, 0,
            10, 1,
          ],
        },
      });
    }

    // Hover-enlargement layer (hidden by default; the filter is set
    // dynamically by the mousemove handler below).
    if (!map.getLayer(CIRCLE_HOVER_LAYER)) {
      map.addLayer({
        id: CIRCLE_HOVER_LAYER,
        type: "symbol",
        source: CIRCLE_SOURCE,
        layout: {
          "icon-image": WARNING_ICON,
          "icon-size": [
            "interpolate", ["linear"], ["zoom"],
            6, 0.12,
            9, 0.16,
            12, 0.26,
            15, 0.38,
          ],
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
          "text-field": "!",
          "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
          "text-size": [
            "interpolate", ["linear"], ["zoom"],
            9, 11,
            12, 17,
            15, 24,
          ],
          "text-anchor": "center",
          "text-allow-overlap": true,
          "text-ignore-placement": true,
        },
        paint: {
          "icon-color": ["get", "winner_color"],
          "icon-halo-color": "rgba(255,255,255,0.95)",
          "icon-halo-width": [
            "interpolate", ["linear"], ["zoom"],
            6, 0.55,
            9, 0.8,
            12, 1.1,
            15, 1.3,
          ],
          "icon-opacity": 1.0,
          "text-color": "#ffffff",
          "text-halo-color": "rgba(0,0,0,0.8)",
          "text-halo-width": 1.25,
          "text-opacity": [
            "interpolate", ["linear"], ["zoom"],
            9, 0,
            10, 1,
          ],
        },
        filter: ["==", "section_code", ""],
      });
    }

    return () => {
      try {
        if (map.getLayer(CIRCLE_HOVER_LAYER)) map.removeLayer(CIRCLE_HOVER_LAYER);
        if (map.getLayer(CIRCLE_LAYER)) map.removeLayer(CIRCLE_LAYER);
        if (map.getSource(CIRCLE_SOURCE)) map.removeSource(CIRCLE_SOURCE);
      } catch {
        /* map already destroyed */
      }
    };
  }, [map, isLoaded, sections, methodology, colorByCode]);

  // Hover + cursor handler
  useEffect(() => {
    if (!map || !isLoaded) return;

    const handleMouseMove = (e: MapLibreGL.MapMouseEvent) => {
      const features = map.queryRenderedFeatures(e.point, {
        layers: [CIRCLE_LAYER],
      });
      if (features.length > 0) {
        map.getCanvas().style.cursor = "pointer";
        const code = features[0].properties?.section_code;
        if (code !== hoveredIdRef.current) {
          hoveredIdRef.current = code;
          map.setFilter(CIRCLE_HOVER_LAYER, ["==", "section_code", code]);
        }
      } else {
        map.getCanvas().style.cursor = "";
        if (hoveredIdRef.current) {
          hoveredIdRef.current = null;
          map.setFilter(CIRCLE_HOVER_LAYER, ["==", "section_code", ""]);
        }
      }
    };

    map.on("mousemove", handleMouseMove);
    return () => {
      map.off("mousemove", handleMouseMove);
    };
  }, [map, isLoaded]);

  return null;
}
