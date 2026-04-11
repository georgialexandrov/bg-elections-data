import { useEffect } from "react";
import type MapLibreGL from "maplibre-gl";
import { useMap } from "@/components/ui/map";
import { useGeoResultsLean } from "@/lib/hooks/use-geo-results.js";
import { MUNI_BORDER_LAYER, MUNI_SOURCE } from "./constants.js";

/**
 * Soft grey municipality boundary lines drawn underneath the section
 * markers — gives the eye some structure without competing with the data.
 *
 * Pulls from the lean `/results/geo` endpoint, not the rich one. Designer
 * note: change `line-color` / `line-width` here, nowhere else.
 */
export function MunicipalityOutlines({ electionId }: { electionId: string }) {
  const { map, isLoaded } = useMap();
  const { data } = useGeoResultsLean(electionId);

  useEffect(() => {
    if (!map || !isLoaded || !data?.municipalities) return;

    const fc = {
      type: "FeatureCollection",
      features: data.municipalities.map((m) => ({
        type: "Feature",
        geometry: m.geo,
        properties: { name: m.name },
      })),
    };

    const existing = map.getSource(MUNI_SOURCE);
    if (existing) {
      (existing as MapLibreGL.GeoJSONSource).setData(fc as any);
    } else {
      map.addSource(MUNI_SOURCE, { type: "geojson", data: fc as any });
    }

    if (!map.getLayer(MUNI_BORDER_LAYER)) {
      // Add this before the circle layers so the markers render on top.
      map.addLayer({
        id: MUNI_BORDER_LAYER,
        type: "line",
        source: MUNI_SOURCE,
        paint: {
          "line-color": "rgba(100,100,100,0.25)",
          "line-width": 0.8,
        },
      });
    }

    return () => {
      try {
        if (map.getLayer(MUNI_BORDER_LAYER)) map.removeLayer(MUNI_BORDER_LAYER);
        if (map.getSource(MUNI_SOURCE)) map.removeSource(MUNI_SOURCE);
      } catch {
        /* map already destroyed */
      }
    };
  }, [map, isLoaded, data]);

  return null;
}
