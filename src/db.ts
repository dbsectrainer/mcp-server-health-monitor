import Database from "better-sqlite3";
import type { ServerHealthRecord, ServerStatusSummary, ServerHealthStatus } from "./types.js";

export type { Database };

export function openDatabase(dbPath: string): Database.Database {
  const db = new Database(dbPath);

  db.exec(`
    CREATE TABLE IF NOT EXISTS health_checks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      server_name TEXT NOT NULL,
      status TEXT NOT NULL,
      latency_ms INTEGER,
      tool_count INTEGER,
      error_message TEXT,
      checked_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_health_server ON health_checks(server_name);
    CREATE INDEX IF NOT EXISTS idx_health_checked_at ON health_checks(checked_at);

    CREATE TABLE IF NOT EXISTS server_schemas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      server_name TEXT NOT NULL,
      schema_hash TEXT NOT NULL,
      schema_json TEXT NOT NULL,
      captured_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_schema_server ON server_schemas(server_name);
    CREATE INDEX IF NOT EXISTS idx_schema_captured_at ON server_schemas(captured_at);
  `);

  return db;
}

export function recordHealthCheck(db: Database.Database, record: ServerHealthRecord): void {
  const stmt = db.prepare(`
    INSERT INTO health_checks (server_name, status, latency_ms, tool_count, error_message, checked_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    record.server_name,
    record.status,
    record.latency_ms,
    record.tool_count,
    record.error_message,
    record.checked_at,
  );
}

interface LatestCheckRow {
  server_name: string;
  status: string;
  latency_ms: number | null;
  tool_count: number | null;
  error_message: string | null;
  checked_at: number;
}

interface ErrorCountRow {
  count: number;
}

interface LastErrorRow {
  error_message: string | null;
}

interface LatencyRow {
  latency_ms: number;
}

interface SchemaRow {
  server_name: string;
  schema_hash: string;
  schema_json: string;
  captured_at: number;
}

export interface LatencyPercentiles {
  p50: number | null;
  p95: number | null;
  sample_count: number;
}

export function getLatencyPercentiles(
  db: Database.Database,
  serverName: string,
  windowHours: number,
): LatencyPercentiles {
  const since = Date.now() - windowHours * 60 * 60 * 1000;

  const rows = db
    .prepare<[string, number], LatencyRow>(
      `SELECT latency_ms
       FROM health_checks
       WHERE server_name = ? AND checked_at >= ? AND latency_ms IS NOT NULL
       ORDER BY latency_ms ASC`,
    )
    .all(serverName, since);

  if (rows.length === 0) {
    return { p50: null, p95: null, sample_count: 0 };
  }

  const values = rows.map((r) => r.latency_ms);
  const p50Index = Math.floor(values.length * 0.5);
  const p95Index = Math.min(Math.floor(values.length * 0.95), values.length - 1);

  return {
    p50: values[p50Index] ?? null,
    p95: values[p95Index] ?? null,
    sample_count: values.length,
  };
}

export function getServerStatus(
  db: Database.Database,
  serverName: string,
): ServerStatusSummary | null {
  const latest = db
    .prepare<[string], LatestCheckRow>(
      `SELECT server_name, status, latency_ms, tool_count, error_message, checked_at
       FROM health_checks
       WHERE server_name = ?
       ORDER BY checked_at DESC
       LIMIT 1`,
    )
    .get(serverName);

  if (!latest) {
    return null;
  }

  const since24h = Date.now() - 24 * 60 * 60 * 1000;
  const errorCountRow = db
    .prepare<[string, number], ErrorCountRow>(
      `SELECT COUNT(*) as count
       FROM health_checks
       WHERE server_name = ? AND checked_at >= ? AND status IN ('offline', 'degraded')`,
    )
    .get(serverName, since24h);

  const lastErrorRow = db
    .prepare<[string], LastErrorRow>(
      `SELECT error_message
       FROM health_checks
       WHERE server_name = ? AND error_message IS NOT NULL
       ORDER BY checked_at DESC
       LIMIT 1`,
    )
    .get(serverName);

  return {
    name: latest.server_name,
    status: latest.status as ServerHealthStatus,
    latency_ms: latest.latency_ms,
    tool_count: latest.tool_count,
    last_seen: latest.checked_at,
    error_count: errorCountRow?.count ?? 0,
    last_error: lastErrorRow?.error_message ?? null,
  };
}

export function getAllServerStatuses(
  db: Database.Database,
  knownServers: string[],
): ServerStatusSummary[] {
  return knownServers.map((name) => {
    const summary = getServerStatus(db, name);
    if (summary) {
      return summary;
    }
    return {
      name,
      status: "unknown" as ServerHealthStatus,
      latency_ms: null,
      tool_count: null,
      last_seen: null,
      error_count: 0,
      last_error: null,
    };
  });
}

export function getDegradedServers(
  db: Database.Database,
  knownServers: string[],
  latencyThreshold: number,
): ServerStatusSummary[] {
  const statuses = getAllServerStatuses(db, knownServers);
  return statuses.filter((s) => {
    if (s.status === "offline" || s.status === "degraded") {
      return true;
    }
    if (s.latency_ms !== null && s.latency_ms > latencyThreshold) {
      return true;
    }
    return false;
  });
}

export interface ServerSchemaRecord {
  server_name: string;
  schema_hash: string;
  schema_json: string;
  captured_at: number;
}

export function recordServerSchema(db: Database.Database, record: ServerSchemaRecord): void {
  const stmt = db.prepare(`
    INSERT INTO server_schemas (server_name, schema_hash, schema_json, captured_at)
    VALUES (?, ?, ?, ?)
  `);
  stmt.run(record.server_name, record.schema_hash, record.schema_json, record.captured_at);
}

export function getLastSchema(
  db: Database.Database,
  serverName: string,
): ServerSchemaRecord | null {
  const row = db
    .prepare<[string], SchemaRow>(
      `SELECT server_name, schema_hash, schema_json, captured_at
       FROM server_schemas
       WHERE server_name = ?
       ORDER BY captured_at DESC
       LIMIT 1`,
    )
    .get(serverName);

  if (!row) return null;

  return {
    server_name: row.server_name,
    schema_hash: row.schema_hash,
    schema_json: row.schema_json,
    captured_at: row.captured_at,
  };
}

export interface HealthHistoryRow {
  id: number;
  server_name: string;
  status: string;
  latency_ms: number | null;
  tool_count: number | null;
  error_message: string | null;
  checked_at: number;
}

export function getServerHistory(
  db: Database.Database,
  serverName: string,
  limit: number,
): HealthHistoryRow[] {
  return db
    .prepare<[string, number], HealthHistoryRow>(
      `SELECT id, server_name, status, latency_ms, tool_count, error_message, checked_at
       FROM health_checks
       WHERE server_name = ?
       ORDER BY checked_at DESC
       LIMIT ?`,
    )
    .all(serverName, limit);
}
