import {
  Map as MapGL,
  MapMarker,
  MarkerContent,
  MapControls,
} from "@/components/ui/map";

/**
 * Mini map showing a single section as a red pin. Always rendered at zoom
 * 15 with the marker centred. Used by every section view (sidebar,
 * `section-detail` page, `section-preview` popover).
 *
 * If the section has no coordinates, the parent should not render this at
 * all — `<SectionLocation>` already handles the absent-coords case.
 *
 * The `key` on `<MapGL>` is deliberate: the shared map component only
 * syncs its `viewport` prop in "controlled" mode (requires
 * `onViewportChange` too). Here we just want the map to re-center when the
 * user picks a different section in the sidebar, so we remount it on every
 * new coordinate instead of threading a viewport callback through.
 */
export function SectionMap({
  lat,
  lng,
  className,
}: {
  lat: number;
  lng: number;
  className?: string;
}) {
  return (
    <div
      className={`h-48 overflow-hidden rounded-lg border border-border ${className ?? ""}`}
    >
      <MapGL
        key={`${lat},${lng}`}
        viewport={{ center: [lng, lat], zoom: 15, bearing: 0, pitch: 0 }}
      >
        <MapMarker latitude={lat} longitude={lng}>
          <MarkerContent>
            <div className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-[#ce463c] shadow-lg">
              <div className="h-2 w-2 rounded-full bg-white" />
            </div>
          </MarkerContent>
        </MapMarker>
        <MapControls position="bottom-right" showZoom showCompass={false} />
      </MapGL>
    </div>
  );
}
