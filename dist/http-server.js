import { randomUUID } from "node:crypto";
import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createHealthMonitorServer } from "./server.js";
import { createAuthMiddleware } from "./auth.js";
import { createRateLimiter } from "./rate-limiter.js";
export async function startHttpServer(options, port) {
  const mcpServer = createHealthMonitorServer(options);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  });
  await mcpServer.connect(transport);
  const app = express();
  app.use(express.json());
  app.use(createAuthMiddleware());
  app.use(createRateLimiter(60, 60000));
  // Wire up all MCP requests to the streamable HTTP transport
  app.all("*", async (req, res) => {
    try {
      await transport.handleRequest(req, res);
    } catch (err) {
      console.error("[mcp-server-health-monitor] HTTP request error:", err);
      if (!res.headersSent) {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  });
  return new Promise((resolve, reject) => {
    const httpServer = app.listen(port, () => {
      const addr = httpServer.address();
      const actualPort = typeof addr === "object" && addr ? addr.port : port;
      console.error(`[mcp-server-health-monitor] HTTP server listening on port ${actualPort}`);
      resolve();
    });
    httpServer.on("error", (err) => {
      reject(err);
    });
  });
}
