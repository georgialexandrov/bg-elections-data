import { useEffect, useRef } from "react";
import { useMap } from "@/components/ui/map";
import { BULGARIA_CENTER, BULGARIA_ZOOM } from "./constants.js";

/**
 * Reactively zooms the map to whatever district/municipality is currently
 * selected. The parent passes a `fitKey` (e.g. `${district}/${municipality}`)
 * and the already-filtered section coordinates — when the key changes and
 * sections are loaded, we compute a bounding box and fitBounds into it.
 * Clearing the filter flies back to the Bulgaria default viewport.
 *
 * We track the last fitted key in a ref so a re-fetch of the same selection
 * doesn't re-zoom the user after they've panned away manually.
 */
export function FitToFilter({
  fitKey,
  points,
}: {
  fitKey: string;
  points: { lat: number | null; lng: number | null }[];
}) {
  const { map, isLoaded } = useMap();
  const lastFittedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!map || !isLoaded) return;
    if (lastFittedRef.current === fitKey) return;

    if (!fitKey) {
      lastFittedRef.current = fitKey;
      map.flyTo({
        center: BULGARIA_CENTER,
        zoom: BULGARIA_ZOOM,
        duration: 600,
      });
      return;
    }

    const coords = points.filter(
      (p): p is { lat: number; lng: number } => p.lat != null && p.lng != null,
    );
    if (coords.length === 0) return;

    let minLng = coords[0].lng;
    let maxLng = coords[0].lng;
    let minLat = coords[0].lat;
    let maxLat = coords[0].lat;
    for (const c of coords) {
      if (c.lng < minLng) minLng = c.lng;
      if (c.lng > maxLng) maxLng = c.lng;
      if (c.lat < minLat) minLat = c.lat;
      if (c.lat > maxLat) maxLat = c.lat;
    }

    lastFittedRef.current = fitKey;
    map.fitBounds(
      [
        [minLng, minLat],
        [maxLng, maxLat],
      ],
      { padding: 60, duration: 600, maxZoom: 13 },
    );
  }, [map, isLoaded, fitKey, points]);

  return null;
}
