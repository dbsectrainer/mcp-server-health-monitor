import type Database from "better-sqlite3";
export interface UptimeReport {
  server: string;
  window_days: number;
  total_checks: number;
  healthy_checks: number;
  uptime_pct: number;
  sla_target_pct: number;
  sla_met: boolean;
}
/**
 * Calculates uptime SLA for a single server over a given time window.
 *
 * @param db          - A better-sqlite3 Database instance.
 * @param serverName  - The name of the server to evaluate.
 * @param windowDays  - Number of days to look back.
 * @param slaTarget   - SLA target percentage (default: 99.9).
 */
export declare function calculateUptime(
  db: Database.Database,
  serverName: string,
  windowDays: number,
  slaTarget?: number,
): UptimeReport;
/**
 * Returns uptime reports for all servers that have health_check records
 * within the given time window.
 *
 * @param db          - A better-sqlite3 Database instance.
 * @param windowDays  - Number of days to look back.
 * @param slaTarget   - SLA target percentage (default: 99.9).
 */
export declare function getAllUptimeReports(
  db: Database.Database,
  windowDays: number,
  slaTarget?: number,
): UptimeReport[];
