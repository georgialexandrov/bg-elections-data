import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiGet } from "./api-client.js";

export function createMcpServer(): McpServer {
  const mcp = new McpServer({
    name: "bg-elections",
    version: "1.0.0",
  });

  // ── Shared schemas ──────────────────────────────────────────────

  const geoFilterSchema = {
    district: z
      .string()
      .optional()
      .describe("District ID to filter by"),
    municipality: z
      .string()
      .optional()
      .describe("Municipality ID to filter by"),
    rik: z
      .string()
      .optional()
      .describe("RIK (regional election commission) ID to filter by"),
    kmetstvo: z
      .string()
      .optional()
      .describe("Kmetstvo (neighbourhood) ID to filter by"),
    local_region: z
      .string()
      .optional()
      .describe("Local region ID to filter by"),
  };

  const paginationSchema = {
    limit: z.number().optional().describe("Max results to return (default 50)"),
    offset: z.number().optional().describe("Pagination offset (default 0)"),
  };

  // ── Tools ───────────────────────────────────────────────────────

  mcp.registerTool("list_elections", {
    title: "List Elections",
    description:
      "List all available Bulgarian elections (2021–2024). Returns election ID, name, date, and type (parliament, president, european, local). Use the returned IDs for other tools.",
    annotations: { readOnlyHint: true },
  }, async () => {
    const data = await apiGet("/elections");
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  });

  mcp.registerTool("get_election_results", {
    title: "Election Results",
    description:
      "Get aggregated vote results for an election — total votes per party. Optionally filter by geographic area. Returns party names and vote totals.",
    inputSchema: z.object({
      election_id: z.number().describe("Election ID (from list_elections)"),
      ...geoFilterSchema,
    }),
    annotations: { readOnlyHint: true },
  }, async ({ election_id, ...geo }) => {
    const data = await apiGet(`/elections/${election_id}/results`, geo);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  });

  mcp.registerTool("get_anomalies", {
    title: "Election Anomalies",
    description:
      "Get polling sections flagged with statistical anomalies for an election. Anomaly types: benford (digit distribution), peer (deviation from similar sections), acf (cross-election autocorrelation), protocol (arithmetic errors in paper protocols). Returns section codes, scores, settlement names, and details.",
    inputSchema: z.object({
      election_id: z.number().describe("Election ID"),
      min_risk: z
        .number()
        .optional()
        .describe("Minimum anomaly score 0–1 (default 0.3)"),
      sort: z
        .string()
        .optional()
        .describe(
          "Sort by: risk_score (default), turnout_rate, benford_score, peer_vote_deviation, protocol_violation_count, section_code, settlement_name"
        ),
      order: z.enum(["asc", "desc"]).optional().describe("Sort order (default desc)"),
      methodology: z
        .enum(["benford", "peer", "acf", "protocol"])
        .optional()
        .describe("Filter to a single anomaly methodology"),
      section: z
        .string()
        .optional()
        .describe("Filter to a specific section code"),
      exclude_special: z
        .boolean()
        .optional()
        .describe("Exclude special sections like embassies (default false)"),
      min_violations: z
        .number()
        .optional()
        .describe("Minimum protocol violation count (default 0)"),
      ...geoFilterSchema,
      ...paginationSchema,
    }),
    annotations: { readOnlyHint: true },
  }, async ({ election_id, ...params }) => {
    const data = await apiGet(`/elections/${election_id}/anomalies`, params);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  });

  mcp.registerTool("get_section_detail", {
    title: "Section Detail",
    description:
      "Get detailed information about a single polling section for a specific election — address, registered/actual voters, protocol data, per-party vote breakdown, and anomaly scores.",
    inputSchema: z.object({
      election_id: z.number().describe("Election ID"),
      section_code: z
        .string()
        .describe("Section code, e.g. '234600001'"),
    }),
    annotations: { readOnlyHint: true },
  }, async ({ election_id, section_code }) => {
    const data = await apiGet(
      `/elections/${election_id}/sections/${section_code}`
    );
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  });

  mcp.registerTool("get_violations", {
    title: "Protocol Violations",
    description:
      "Get protocol arithmetic violations for an election. These are errors in the paper protocols filled by election commissions — mismatched sums, impossible numbers, etc. Without a section code, returns a summary. With a section code, returns detailed violations for that section.",
    inputSchema: z.object({
      election_id: z.number().describe("Election ID"),
      section_code: z
        .string()
        .optional()
        .describe("Optional section code for drill-down"),
    }),
    annotations: { readOnlyHint: true },
  }, async ({ election_id, section_code }) => {
    const path = section_code
      ? `/elections/${election_id}/violations/${section_code}`
      : `/elections/${election_id}/violations`;
    const data = await apiGet(path);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  });

  mcp.registerTool("get_turnout", {
    title: "Voter Turnout",
    description:
      "Get voter turnout data for an election, grouped by a geographic level. Returns registered voters, actual voters, and turnout percentage for each group.",
    inputSchema: z.object({
      election_id: z.number().describe("Election ID"),
      group_by: z
        .enum(["rik", "district", "municipality", "kmetstvo", "local_region"])
        .describe("Geographic level to group by"),
      ...geoFilterSchema,
    }),
    annotations: { readOnlyHint: true },
  }, async ({ election_id, group_by, ...geo }) => {
    const data = await apiGet(`/elections/${election_id}/turnout`, {
      group_by,
      ...geo,
    });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  });

  mcp.registerTool("compare_elections", {
    title: "Compare Elections",
    description:
      "Compare results across 2–10 elections. Shows how party vote shares changed between elections. Optionally filter to a specific geographic area.",
    inputSchema: z.object({
      election_ids: z
        .array(z.number())
        .min(2)
        .max(10)
        .describe("Array of election IDs to compare"),
      ...geoFilterSchema,
    }),
    annotations: { readOnlyHint: true },
  }, async ({ election_ids, ...geo }) => {
    const data = await apiGet("/elections/compare", {
      elections: election_ids.join(","),
      ...geo,
    });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  });

  mcp.registerTool("get_persistence", {
    title: "Persistence Index",
    description:
      "Find polling sections where the same anomaly patterns persist across multiple elections. High persistence suggests systemic issues rather than one-off errors. Returns sections ranked by persistence score.",
    inputSchema: z.object({
      min_elections: z
        .number()
        .optional()
        .describe("Minimum elections a section must appear in (default 5)"),
      min_score: z
        .number()
        .optional()
        .describe("Minimum persistence score (default 0)"),
      sort: z
        .enum(["persistence_score"])
        .optional()
        .describe("Sort field (default persistence_score)"),
      order: z.enum(["asc", "desc"]).optional(),
      section: z.string().optional().describe("Filter to a specific section code"),
      exclude_special: z.boolean().optional(),
      ...paginationSchema,
    }),
    annotations: { readOnlyHint: true },
  }, async (params) => {
    const data = await apiGet("/elections/persistence", params);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  });

  mcp.registerTool("get_persistence_detail", {
    title: "Section Persistence History",
    description:
      "Get the full election-by-election anomaly history for a specific polling section. Shows how anomaly scores evolved across all elections the section participated in.",
    inputSchema: z.object({
      section_code: z.string().describe("Section code"),
    }),
    annotations: { readOnlyHint: true },
  }, async ({ section_code }) => {
    const data = await apiGet(`/elections/persistence/${section_code}`);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  });

  mcp.registerTool("get_results_by_district", {
    title: "Results by District",
    description:
      "Get election results broken down by district (oblast). Returns per-party votes and percentages for each of Bulgaria's 31 districts.",
    inputSchema: z.object({
      election_id: z.number().describe("Election ID"),
    }),
    annotations: { readOnlyHint: true },
  }, async ({ election_id }) => {
    const data = await apiGet(
      `/elections/${election_id}/results/geo/districts`
    );
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  });

  mcp.registerTool("get_results_by_municipality", {
    title: "Results by Municipality",
    description:
      "Get election results broken down by municipality. Returns per-party votes and percentages for each municipality.",
    inputSchema: z.object({
      election_id: z.number().describe("Election ID"),
    }),
    annotations: { readOnlyHint: true },
  }, async ({ election_id }) => {
    const data = await apiGet(
      `/elections/${election_id}/results/geo/municipalities`
    );
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  });

  mcp.registerTool("list_districts", {
    title: "List Districts",
    description:
      "List all Bulgarian districts (oblasts) with their IDs and section counts. Use district IDs as geo filters in other tools.",
    annotations: { readOnlyHint: true },
  }, async () => {
    const data = await apiGet("/geography/districts");
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  });

  mcp.registerTool("list_municipalities", {
    title: "List Municipalities",
    description:
      "List municipalities, optionally filtered by district ID.",
    inputSchema: z.object({
      district: z.string().optional().describe("District ID to filter by"),
    }),
    annotations: { readOnlyHint: true },
  }, async (params) => {
    const data = await apiGet("/geography/municipalities", params);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  });

  mcp.registerTool("get_section_siblings", {
    title: "Section Siblings",
    description:
      "Get all polling sections at the same physical location as the given section. Useful for peer comparison — sections in the same building should have similar patterns.",
    inputSchema: z.object({
      section_code: z.string().describe("Section code"),
    }),
    annotations: { readOnlyHint: true },
  }, async ({ section_code }) => {
    const data = await apiGet(`/geography/section-siblings/${section_code}`);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  });

  return mcp;
}
