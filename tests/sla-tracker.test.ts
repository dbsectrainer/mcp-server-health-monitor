import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { openDatabase, recordHealthCheck } from "../src/db.js";
import { calculateUptime, getAllUptimeReports } from "../src/sla-tracker.js";

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function createInMemoryDb(): Database.Database {
  return openDatabase(":memory:");
}

function insertChecks(
  db: Database.Database,
  serverName: string,
  statuses: string[],
  baseTime = Date.now(),
): void {
  statuses.forEach((status, i) => {
    recordHealthCheck(db, {
      server_name: serverName,
      status,
      latency_ms: status === "healthy" ? 100 : null,
      tool_count: null,
      error_message: null,
      checked_at: baseTime - i * 60_000, // 1 minute apart
    });
  });
}

// --------------------------------------------------------------------------
// Tests
// --------------------------------------------------------------------------

describe("calculateUptime", () => {
  it("returns 0% uptime when no checks exist", () => {
    const db = createInMemoryDb();
    const report = calculateUptime(db, "ghost-server", 7);

    expect(report.server).toBe("ghost-server");
    expect(report.total_checks).toBe(0);
    expect(report.healthy_checks).toBe(0);
    expect(report.uptime_pct).toBe(0);
    expect(report.sla_met).toBe(false);
    db.close();
  });

  it("calculates 100% uptime for all-healthy checks", () => {
    const db = createInMemoryDb();
    insertChecks(db, "perfect-server", ["healthy", "healthy", "healthy", "healthy"]);

    const report = calculateUptime(db, "perfect-server", 7);
    expect(report.total_checks).toBe(4);
    expect(report.healthy_checks).toBe(4);
    expect(report.uptime_pct).toBe(100);
    expect(report.sla_met).toBe(true);
    db.close();
  });

  it("calculates 75% uptime for 3 healthy out of 4 checks", () => {
    const db = createInMemoryDb();
    insertChecks(db, "flaky-server", ["healthy", "healthy", "healthy", "offline"]);

    const report = calculateUptime(db, "flaky-server", 7);
    expect(report.total_checks).toBe(4);
    expect(report.healthy_checks).toBe(3);
    expect(report.uptime_pct).toBe(75);
    expect(report.sla_met).toBe(false); // 75 < 99.9
    db.close();
  });

  it("uses default SLA target of 99.9", () => {
    const db = createInMemoryDb();
    insertChecks(db, "server-a", Array(1000).fill("healthy"));

    const report = calculateUptime(db, "server-a", 7);
    expect(report.sla_target_pct).toBe(99.9);
    expect(report.sla_met).toBe(true);
    db.close();
  });

  it("uses custom SLA target when provided", () => {
    const db = createInMemoryDb();
    // 75% uptime
    insertChecks(db, "server-b", ["healthy", "healthy", "healthy", "offline"]);

    const report = calculateUptime(db, "server-b", 7, 70);
    expect(report.sla_target_pct).toBe(70);
    expect(report.sla_met).toBe(true); // 75 >= 70
    db.close();
  });

  it("only counts checks within the time window", () => {
    const db = createInMemoryDb();
    const now = Date.now();
    const ninetyDaysAgo = now - 90 * 24 * 60 * 60 * 1000;

    // Old check outside 7-day window
    recordHealthCheck(db, {
      server_name: "window-server",
      status: "offline",
      latency_ms: null,
      tool_count: null,
      error_message: null,
      checked_at: ninetyDaysAgo,
    });

    // Recent healthy check inside 7-day window
    recordHealthCheck(db, {
      server_name: "window-server",
      status: "healthy",
      latency_ms: 50,
      tool_count: null,
      error_message: null,
      checked_at: now - 1000,
    });

    const report = calculateUptime(db, "window-server", 7);
    expect(report.total_checks).toBe(1);
    expect(report.healthy_checks).toBe(1);
    expect(report.uptime_pct).toBe(100);
    db.close();
  });

  it("reports window_days correctly", () => {
    const db = createInMemoryDb();
    insertChecks(db, "some-server", ["healthy"]);

    const report = calculateUptime(db, "some-server", 30);
    expect(report.window_days).toBe(30);
    db.close();
  });
});

describe("getAllUptimeReports", () => {
  it("returns empty array when no health checks exist", () => {
    const db = createInMemoryDb();
    const reports = getAllUptimeReports(db, 7);
    expect(reports).toHaveLength(0);
    db.close();
  });

  it("returns a report for each distinct server with checks in window", () => {
    const db = createInMemoryDb();
    insertChecks(db, "alpha", ["healthy", "healthy"]);
    insertChecks(db, "beta", ["healthy", "offline"]);
    insertChecks(db, "gamma", ["offline"]);

    const reports = getAllUptimeReports(db, 7);
    expect(reports).toHaveLength(3);

    const names = reports.map((r) => r.server).sort();
    expect(names).toEqual(["alpha", "beta", "gamma"]);
    db.close();
  });

  it("passes slaTarget through to each report", () => {
    const db = createInMemoryDb();
    insertChecks(db, "delta", ["healthy"]);

    const reports = getAllUptimeReports(db, 7, 80);
    expect(reports[0]!.sla_target_pct).toBe(80);
    db.close();
  });

  it("excludes servers with checks only outside the window", () => {
    const db = createInMemoryDb();
    const oldTime = Date.now() - 90 * 24 * 60 * 60 * 1000;

    recordHealthCheck(db, {
      server_name: "ancient-server",
      status: "healthy",
      latency_ms: 100,
      tool_count: null,
      error_message: null,
      checked_at: oldTime,
    });

    const reports = getAllUptimeReports(db, 7);
    const names = reports.map((r) => r.server);
    expect(names).not.toContain("ancient-server");
    db.close();
  });
});
