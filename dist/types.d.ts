export type ServerHealthStatus = "healthy" | "degraded" | "offline" | "unknown";
export interface McpServerEntry {
  name: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
}
export interface McpConfig {
  mcpServers: Record<string, McpServerEntry>;
}
export interface ServerHealthRecord {
  server_name: string;
  status: ServerHealthStatus;
  latency_ms: number | null;
  tool_count: number | null;
  error_message: string | null;
  checked_at: number;
}
export interface ServerStatusSummary {
  name: string;
  status: ServerHealthStatus;
  latency_ms: number | null;
  tool_count: number | null;
  last_seen: number | null;
  error_count: number;
  last_error: string | null;
}
