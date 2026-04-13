/**
 * HTTP client that calls the local API endpoints.
 * In production, requests go through nginx and hit the cache layer.
 * In dev, they go directly to the Hono server.
 */

const BASE =
  process.env.MCP_API_BASE ?? `http://localhost:${process.env.PORT ?? 3000}`;

export async function apiGet<T = unknown>(
  path: string,
  params?: Record<string, string | number | boolean | undefined>
): Promise<T> {
  const url = new URL(`/api${path}`, BASE);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
    }
  }
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`API ${res.status} ${path}: ${body}`);
  }
  return res.json() as Promise<T>;
}
