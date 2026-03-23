import Database from "better-sqlite3";
import type { ServerHealthRecord, ServerStatusSummary } from "./types.js";
export type { Database };
export declare function openDatabase(dbPath: string): Database.Database;
export declare function recordHealthCheck(db: Database.Database, record: ServerHealthRecord): void;
export interface LatencyPercentiles {
    p50: number | null;
    p95: number | null;
    sample_count: number;
}
export declare function getLatencyPercentiles(db: Database.Database, serverName: string, windowHours: number): LatencyPercentiles;
export declare function getServerStatus(db: Database.Database, serverName: string): ServerStatusSummary | null;
export declare function getAllServerStatuses(db: Database.Database, knownServers: string[]): ServerStatusSummary[];
export declare function getDegradedServers(db: Database.Database, knownServers: string[], latencyThreshold: number): ServerStatusSummary[];
export interface ServerSchemaRecord {
    server_name: string;
    schema_hash: string;
    schema_json: string;
    captured_at: number;
}
export declare function recordServerSchema(db: Database.Database, record: ServerSchemaRecord): void;
export declare function getLastSchema(db: Database.Database, serverName: string): ServerSchemaRecord | null;
export interface HealthHistoryRow {
    id: number;
    server_name: string;
    status: string;
    latency_ms: number | null;
    tool_count: number | null;
    error_message: string | null;
    checked_at: number;
}
export declare function getServerHistory(db: Database.Database, serverName: string, limit: number): HealthHistoryRow[];
