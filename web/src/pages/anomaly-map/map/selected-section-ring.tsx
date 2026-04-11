import { useEffect } from "react";
import { useMap } from "@/components/ui/map";
import { BASE_SOURCE, CIRCLE_SOURCE, SELECTED_LAYER } from "./constants.js";

/**
 * Blue ring drawn around the currently-selected section. The same ring
 * needs to render whether the section came from the base-circles source or
 * the anomaly-triangles source, so we add a ring layer on each.
 *
 * The ring layer is created lazily — we wait until the underlying source
 * exists, otherwise MapLibre throws.
 */
export function SelectedSectionRing({
  sectionCode,
}: {
  sectionCode: string | null;
}) {
  const { map, isLoaded } = useMap();

  useEffect(() => {
    if (!map || !isLoaded) return;

    const layers = [
      { source: BASE_SOURCE, id: `${SELECTED_LAYER}-base` },
      { source: CIRCLE_SOURCE, id: `${SELECTED_LAYER}-risk` },
    ];

    for (const { source, id } of layers) {
      if (!map.getSource(source)) continue;
      if (!map.getLayer(id)) {
        map.addLayer({
          id,
          type: "circle",
          source,
          paint: {
            "circle-radius": [
              "interpolate", ["linear"], ["zoom"],
              6, 8,
              9, 14,
              12, 20,
              15, 28,
            ],
            "circle-color": "transparent",
            "circle-stroke-width": 2.5,
            "circle-stroke-color": "#3b82f6",
          },
          filter: ["==", "section_code", ""],
        });
      }
      map.setFilter(
        id,
        sectionCode
          ? ["==", "section_code", sectionCode]
          : ["==", "section_code", ""],
      );
    }
  }, [map, isLoaded, sectionCode]);

  // Cleanup on unmount — remove both ring layers if they exist.
  useEffect(() => {
    return () => {
      if (!map) return;
      const ids = [`${SELECTED_LAYER}-base`, `${SELECTED_LAYER}-risk`];
      for (const id of ids) {
        try {
          if (map.getLayer(id)) map.removeLayer(id);
        } catch {
          /* already removed */
        }
      }
    };
  }, [map]);

  return null;
}
