// Spatial arrangement of colour tiles inside a region.
//
// The per-colour tile *counts* are fixed by the vote shares; this only
// decides *which* cell gets which colour. Instead of a white-noise shuffle
// (clumps and holes — reads as TV static), cells are ordered by an R2
// low-discrepancy threshold, i.e. ordered dithering: any contiguous run of
// that order is spread evenly over the region, so each colour block comes
// out as an even stipple with no clumps. Zoomed out the map blends into a
// smooth tone per municipality; zoomed in it is a regular pattern.

// Roberts' R2 lattice (generalised golden ratio).
const R2_A = 0.7548776662466927;
const R2_B = 0.5698402909980532;

/** Cell indices in lay-down order. The threshold is keyed on the global
 *  grid index (centre ÷ step on the shared lattice), not the region's bbox,
 *  so the same colour block lands on the same lattice positions on both
 *  sides of a border. */
export function arrangeCells(
  cells: [number, number][],
  stepX: number,
  stepY: number,
): number[] {
  const t = cells.map(([x, y]) => {
    const v = Math.floor(x / stepX) * R2_A + Math.floor(y / stepY) * R2_B;
    return v - Math.floor(v);
  });
  const order = Array.from({ length: cells.length }, (_, i) => i);
  order.sort((a, b) => t[a] - t[b] || a - b);
  return order;
}
