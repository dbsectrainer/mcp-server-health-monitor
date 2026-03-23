import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { McpServerEntry } from "../types.js";
import type { ProbeResult } from "./base.js";

export async function probeServer(server: McpServerEntry, timeoutMs = 5000): Promise<ProbeResult> {
  const startTime = Date.now();

  if (!server.command) {
    return {
      status: "offline",
      latencyMs: null,
      toolCount: null,
      message: "No command configured",
    };
  }

  const transport = new StdioClientTransport({
    command: server.command,
    args: server.args ?? [],
    env: { ...process.env, ...(server.env ?? {}) } as Record<string, string>,
  });

  const client = new Client({ name: "health-monitor", version: "0.1.0" }, { capabilities: {} });

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<ProbeResult>((resolve) => {
    timeoutHandle = setTimeout(() => {
      resolve({
        status: "offline",
        latencyMs: timeoutMs,
        toolCount: null,
        message: "Probe timed out",
      });
    }, timeoutMs);
  });

  const probePromise = async (): Promise<ProbeResult> => {
    try {
      await client.connect(transport);
      const result = await client.listTools();
      const latency = Date.now() - startTime;
      await client.close();
      return {
        status: "healthy",
        latencyMs: latency,
        toolCount: result.tools.length,
        tools: result.tools.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      };
    } catch (err) {
      // Attempt to close client in case of partial connection
      try {
        await client.close();
      } catch {
        // Ignore close errors
      }
      return {
        status: "offline",
        latencyMs: Date.now() - startTime,
        toolCount: null,
        message: err instanceof Error ? err.message : String(err),
      };
    }
  };

  const probeRace = probePromise().then((result) => {
    clearTimeout(timeoutHandle);
    return result;
  });

  const result = await Promise.race([probeRace, timeoutPromise]);

  // If the timeout won, the probePromise is still running in the background.
  // Close the client/transport to release the subprocess and stdio handles.
  if (result.message === "Probe timed out") {
    try {
      await client.close();
    } catch {
      // Ignore close errors — transport may not have connected yet
    }
  }

  return result;
}
