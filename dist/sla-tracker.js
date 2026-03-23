const DEFAULT_SLA_TARGET = 99.9;
/**
 * Calculates uptime SLA for a single server over a given time window.
 *
 * @param db          - A better-sqlite3 Database instance.
 * @param serverName  - The name of the server to evaluate.
 * @param windowDays  - Number of days to look back.
 * @param slaTarget   - SLA target percentage (default: 99.9).
 */
export function calculateUptime(db, serverName, windowDays, slaTarget = DEFAULT_SLA_TARGET) {
  const since = Date.now() - windowDays * 24 * 60 * 60 * 1000;
  const rows = db
    .prepare(
      `SELECT status FROM health_checks
         WHERE server_name = ? AND checked_at >= ?`,
    )
    .all(serverName, since);
  const total = rows.length;
  const healthy = rows.filter((r) => r.status === "healthy").length;
  const pct = total > 0 ? (healthy / total) * 100 : 0;
  return {
    server: serverName,
    window_days: windowDays,
    total_checks: total,
    healthy_checks: healthy,
    uptime_pct: Math.round(pct * 1000) / 1000,
    sla_target_pct: slaTarget,
    sla_met: pct >= slaTarget,
  };
}
/**
 * Returns uptime reports for all servers that have health_check records
 * within the given time window.
 *
 * @param db          - A better-sqlite3 Database instance.
 * @param windowDays  - Number of days to look back.
 * @param slaTarget   - SLA target percentage (default: 99.9).
 */
export function getAllUptimeReports(db, windowDays, slaTarget = DEFAULT_SLA_TARGET) {
  const since = Date.now() - windowDays * 24 * 60 * 60 * 1000;
  const servers = db
    .prepare(`SELECT DISTINCT server_name FROM health_checks WHERE checked_at >= ?`)
    .all(since);
  return servers.map((row) => calculateUptime(db, row.server_name, windowDays, slaTarget));
}
