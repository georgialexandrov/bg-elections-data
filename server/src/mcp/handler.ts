import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createMcpServer } from "./server.js";

/**
 * Stateless MCP request handler.
 * Each request gets a fresh transport+server — no session state.
 * The heavy lifting is cached at the nginx/API layer, not here.
 */
export async function handleMcpRequest(req: Request): Promise<Response> {
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
    enableJsonResponse: true,
  });
  const mcp = createMcpServer();
  await mcp.connect(transport);

  try {
    return await transport.handleRequest(req);
  } finally {
    await mcp.close();
  }
}
