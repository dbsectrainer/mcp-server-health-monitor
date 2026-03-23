import type { McpServerEntry } from "../types.js";
import type { ProbeResult } from "./base.js";
export declare function probeServer(server: McpServerEntry, timeoutMs?: number): Promise<ProbeResult>;
