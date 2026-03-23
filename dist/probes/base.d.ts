import type { McpServerEntry } from "../types.js";
export interface ProbeResult {
  status: "healthy" | "degraded" | "offline";
  latencyMs: number | null;
  toolCount: number | null;
  tools?: Array<{
    name: string;
    description?: string;
    inputSchema?: unknown;
  }>;
  message?: string;
}
export interface Probe {
  probe(server: McpServerEntry, timeoutMs: number): Promise<ProbeResult>;
}
