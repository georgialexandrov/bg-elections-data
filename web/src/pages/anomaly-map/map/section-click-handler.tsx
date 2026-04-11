import { useEffect, useRef } from "react";
import type MapLibreGL from "maplibre-gl";
import { useMap } from "@/components/ui/map";
import { CIRCLE_LAYER } from "./constants.js";

/**
 * Listens for clicks on the anomaly triangle layer and forwards the
 * section_code to the parent. The base-circles layer has its own click
 * handler in `all-sections-layer.tsx` that defers to this one when both
 * layers are hit.
 */
export function SectionClickHandler({
  onSectionClick,
}: {
  onSectionClick: (sectionCode: string) => void;
}) {
  const { map, isLoaded } = useMap();
  const onClickRef = useRef(onSectionClick);
  onClickRef.current = onSectionClick;

  useEffect(() => {
    if (!map || !isLoaded) return;

    const handleClick = (e: MapLibreGL.MapMouseEvent) => {
      const features = map.queryRenderedFeatures(e.point, {
        layers: [CIRCLE_LAYER],
      });
      if (!features.length) return;
      const code = features[0].properties?.section_code;
      if (code) onClickRef.current(code);
    };

    map.on("click", CIRCLE_LAYER, handleClick);
    return () => {
      map.off("click", CIRCLE_LAYER, handleClick);
    };
  }, [map, isLoaded]);

  return null;
}
