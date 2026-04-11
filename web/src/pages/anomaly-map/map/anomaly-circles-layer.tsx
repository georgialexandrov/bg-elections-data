import { useEffect, useRef } from "react";
import type MapLibreGL from "maplibre-gl";
import { useMap } from "@/components/ui/map";
import type { AnomalyMethodology, AnomalySection } from "@/lib/api/types.js";
import { buildCircleFeatures, ensureTriangleIcon } from "./utils.js";
import {
  CIRCLE_HOVER_LAYER,
  CIRCLE_LAYER,
  CIRCLE_SOURCE,
  TRIANGLE_ICON,
} from "./constants.js";

/**
 * The triangle markers that highlight flagged sections on top of the base
 * winner-coloured layer. Marker size and colour both interpolate against the
 * `risk` property baked into each feature, so a designer can re-tune the
 * scale by editing the two paint expressions in this file.
 *
 * Two layers share one source: a normal layer and a hidden hover layer
 * filtered to one section_code at a time, so hovering enlarges the marker
 * without re-rendering the source.
 */
export function AnomalyCirclesLayer({
  sections,
  methodology,
}: {
  sections: AnomalySection[];
  methodology: AnomalyMethodology;
}) {
  const { map, isLoaded } = useMap();
  const hoveredIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!map || !isLoaded || sections.length === 0) return;

    ensureTriangleIcon(map);
    const fc = buildCircleFeatures(sections, methodology);

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
          "icon-image": TRIANGLE_ICON,
          "icon-size": [
            "interpolate", ["linear"], ["get", "risk"],
            0.3, 0.35,
            0.5, 0.55,
            0.7, 0.75,
            1.0, 1.0,
          ],
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
        },
        paint: {
          "icon-color": [
            "interpolate", ["linear"], ["get", "risk"],
            0.3, "#facc15",  // yellow
            0.5, "#f97316",  // orange
            0.7, "#ef4444",  // red
            1.0, "#991b1b",  // dark red
          ],
          "icon-opacity": 0.9,
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
          "icon-image": TRIANGLE_ICON,
          "icon-size": [
            "interpolate", ["linear"], ["get", "risk"],
            0.3, 0.5,
            0.5, 0.7,
            0.7, 0.9,
            1.0, 1.3,
          ],
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
        },
        paint: {
          "icon-color": [
            "interpolate", ["linear"], ["get", "risk"],
            0.3, "#facc15",
            0.5, "#f97316",
            0.7, "#ef4444",
            1.0, "#991b1b",
          ],
          "icon-opacity": 1.0,
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
  }, [map, isLoaded, sections, methodology]);

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
