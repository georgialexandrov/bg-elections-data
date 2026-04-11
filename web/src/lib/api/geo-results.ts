import { apiGet } from "./client.js";
import type {
  AbroadByCountryResponse,
  GeoArea,
  GeoMunicipalityLean,
  GeoResultsLeanResponse,
  Election,
} from "./types.js";

/**
 * Per-area aggregated election results, with GeoJSON geometry attached.
 *
 * `getGeoResults(electionId, level)` returns the rich shape with voter
 * totals, used by the proportional district pie map and the rich district
 * popups. `getGeoResultsLean(electionId)` is the smaller payload used as a
 * background outline / municipality list.
 */

export type GeoLevel = "districts" | "municipalities" | "riks";

export interface GeoResultsByLevel {
  election: Election;
  areas: GeoArea[];
}

export async function getGeoResults(
  electionId: number | string,
  level: GeoLevel,
): Promise<GeoResultsByLevel> {
  type Raw = {
    election: Election;
    districts?: GeoArea[];
    municipalities?: GeoArea[];
    riks?: GeoArea[];
  };
  const raw = await apiGet<Raw>(
    `/elections/${electionId}/results/geo/${level}`,
  );
  const areas = raw[level] ?? [];
  return { election: raw.election, areas };
}

export function getGeoResultsLean(
  electionId: number | string,
): Promise<GeoResultsLeanResponse> {
  return apiGet<GeoResultsLeanResponse>(`/elections/${electionId}/results/geo`);
}

/**
 * Per-country roll-up of the abroad (diaspora) vote for one election.
 * Powers the world-map inset on the /results page.
 */
export function getAbroadByCountry(
  electionId: number | string,
): Promise<AbroadByCountryResponse> {
  return apiGet<AbroadByCountryResponse>(
    `/elections/${electionId}/results/abroad-by-country`,
  );
}

export type { GeoArea, GeoMunicipalityLean };
