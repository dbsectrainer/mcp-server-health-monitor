import Database from "better-sqlite3";
export function openDatabase(dbPath) {
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
export function recordHealthCheck(db, record) {
    const stmt = db.prepare(`
    INSERT INTO health_checks (server_name, status, latency_ms, tool_count, error_message, checked_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
    stmt.run(record.server_name, record.status, record.latency_ms, record.tool_count, record.error_message, record.checked_at);
}
export function getLatencyPercentiles(db, serverName, windowHours) {
    const since = Date.now() - windowHours * 60 * 60 * 1000;
    const rows = db
        .prepare(`SELECT latency_ms
       FROM health_checks
       WHERE server_name = ? AND checked_at >= ? AND latency_ms IS NOT NULL
       ORDER BY latency_ms ASC`)
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
export function getServerStatus(db, serverName) {
    const latest = db
        .prepare(`SELECT server_name, status, latency_ms, tool_count, error_message, checked_at
       FROM health_checks
       WHERE server_name = ?
       ORDER BY checked_at DESC
       LIMIT 1`)
        .get(serverName);
    if (!latest) {
        return null;
    }
    const since24h = Date.now() - 24 * 60 * 60 * 1000;
    const errorCountRow = db
        .prepare(`SELECT COUNT(*) as count
       FROM health_checks
       WHERE server_name = ? AND checked_at >= ? AND status IN ('offline', 'degraded')`)
        .get(serverName, since24h);
    const lastErrorRow = db
        .prepare(`SELECT error_message
       FROM health_checks
       WHERE server_name = ? AND error_message IS NOT NULL
       ORDER BY checked_at DESC
       LIMIT 1`)
        .get(serverName);
    return {
        name: latest.server_name,
        status: latest.status,
        latency_ms: latest.latency_ms,
        tool_count: latest.tool_count,
        last_seen: latest.checked_at,
        error_count: errorCountRow?.count ?? 0,
        last_error: lastErrorRow?.error_message ?? null,
    };
}
export function getAllServerStatuses(db, knownServers) {
    return knownServers.map((name) => {
        const summary = getServerStatus(db, name);
        if (summary) {
            return summary;
        }
        return {
            name,
            status: "unknown",
            latency_ms: null,
            tool_count: null,
            last_seen: null,
            error_count: 0,
            last_error: null,
        };
    });
}
export function getDegradedServers(db, knownServers, latencyThreshold) {
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
export function recordServerSchema(db, record) {
    const stmt = db.prepare(`
    INSERT INTO server_schemas (server_name, schema_hash, schema_json, captured_at)
    VALUES (?, ?, ?, ?)
  `);
    stmt.run(record.server_name, record.schema_hash, record.schema_json, record.captured_at);
}
export function getLastSchema(db, serverName) {
    const row = db
        .prepare(`SELECT server_name, schema_hash, schema_json, captured_at
       FROM server_schemas
       WHERE server_name = ?
       ORDER BY captured_at DESC
       LIMIT 1`)
        .get(serverName);
    if (!row)
        return null;
    return {
        server_name: row.server_name,
        schema_hash: row.schema_hash,
        schema_json: row.schema_json,
        captured_at: row.captured_at,
    };
}
export function getServerHistory(db, serverName, limit) {
    return db
        .prepare(`SELECT id, server_name, status, latency_ms, tool_count, error_message, checked_at
       FROM health_checks
       WHERE server_name = ?
       ORDER BY checked_at DESC
       LIMIT ?`)
        .all(serverName, limit);
}
