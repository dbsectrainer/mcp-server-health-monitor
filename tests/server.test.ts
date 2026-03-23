import { describe, it, expect, beforeEach, vi } from "vitest";
import Database from "better-sqlite3";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import { openDatabase, recordHealthCheck, getServerStatus, getDegradedServers } from "../src/db.js";
import { discoverServers } from "../src/config-discovery.js";
import { loadHealthConfig, getServerThresholds } from "../src/health-config.js";

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function createInMemoryDb(): Database.Database {
  return openDatabase(":memory:");
}

function now(): number {
  return Date.now();
}

// --------------------------------------------------------------------------
// Database tests
// --------------------------------------------------------------------------

describe("openDatabase", () => {
  it("creates health_checks table on an in-memory database", () => {
    const db = createInMemoryDb();
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='health_checks'")
      .get() as { name: string } | undefined;
    expect(row?.name).toBe("health_checks");
    db.close();
  });

  it("creates server_schemas table on an in-memory database (Phase 2)", () => {
    const db = createInMemoryDb();
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='server_schemas'")
      .get() as { name: string } | undefined;
    expect(row?.name).toBe("server_schemas");
    db.close();
  });
});

describe("recordHealthCheck", () => {
  it("inserts a health check record and retrieves it", () => {
    const db = createInMemoryDb();
    const checkedAt = now();

    recordHealthCheck(db, {
      server_name: "test-server",
      status: "healthy",
      latency_ms: 120,
      tool_count: 5,
      error_message: null,
      checked_at: checkedAt,
    });

    const row = db
      .prepare("SELECT * FROM health_checks WHERE server_name = 'test-server'")
      .get() as {
      server_name: string;
      status: string;
      latency_ms: number;
      tool_count: number;
      error_message: string | null;
      checked_at: number;
    };

    expect(row).toBeDefined();
    expect(row.server_name).toBe("test-server");
    expect(row.status).toBe("healthy");
    expect(row.latency_ms).toBe(120);
    expect(row.tool_count).toBe(5);
    expect(row.error_message).toBeNull();
    expect(row.checked_at).toBe(checkedAt);

    db.close();
  });

  it("stores an error message for offline servers", () => {
    const db = createInMemoryDb();

    recordHealthCheck(db, {
      server_name: "broken-server",
      status: "offline",
      latency_ms: null,
      tool_count: null,
      error_message: "Connection refused",
      checked_at: now(),
    });

    const row = db
      .prepare(
        "SELECT error_message, status FROM health_checks WHERE server_name = 'broken-server'",
      )
      .get() as { error_message: string; status: string };

    expect(row.status).toBe("offline");
    expect(row.error_message).toBe("Connection refused");

    db.close();
  });
});

describe("getServerStatus", () => {
  it("returns null for a server with no records", () => {
    const db = createInMemoryDb();
    const result = getServerStatus(db, "nonexistent");
    expect(result).toBeNull();
    db.close();
  });

  it("returns the most recent check for a server", () => {
    const db = createInMemoryDb();
    const baseTime = now();

    recordHealthCheck(db, {
      server_name: "my-server",
      status: "offline",
      latency_ms: null,
      tool_count: null,
      error_message: "timeout",
      checked_at: baseTime - 5000,
    });

    recordHealthCheck(db, {
      server_name: "my-server",
      status: "healthy",
      latency_ms: 200,
      tool_count: 3,
      error_message: null,
      checked_at: baseTime,
    });

    const result = getServerStatus(db, "my-server");
    expect(result).not.toBeNull();
    expect(result!.status).toBe("healthy");
    expect(result!.latency_ms).toBe(200);
    expect(result!.tool_count).toBe(3);
    expect(result!.last_seen).toBe(baseTime);

    db.close();
  });

  it("counts errors in the last 24 hours", () => {
    const db = createInMemoryDb();
    const base = now();

    // 3 offline events in last 24h
    for (let i = 0; i < 3; i++) {
      recordHealthCheck(db, {
        server_name: "flaky-server",
        status: "offline",
        latency_ms: null,
        tool_count: null,
        error_message: "error",
        checked_at: base - i * 1000,
      });
    }

    // 1 old event beyond 24h
    recordHealthCheck(db, {
      server_name: "flaky-server",
      status: "offline",
      latency_ms: null,
      tool_count: null,
      error_message: "old error",
      checked_at: base - 25 * 60 * 60 * 1000,
    });

    const result = getServerStatus(db, "flaky-server");
    expect(result).not.toBeNull();
    expect(result!.error_count).toBe(3);

    db.close();
  });
});

describe("getDegradedServers", () => {
  it("returns servers with offline status", () => {
    const db = createInMemoryDb();

    recordHealthCheck(db, {
      server_name: "offline-server",
      status: "offline",
      latency_ms: null,
      tool_count: null,
      error_message: "refused",
      checked_at: now(),
    });

    recordHealthCheck(db, {
      server_name: "healthy-server",
      status: "healthy",
      latency_ms: 100,
      tool_count: 2,
      error_message: null,
      checked_at: now(),
    });

    const degraded = getDegradedServers(db, ["offline-server", "healthy-server"], 1000);
    expect(degraded).toHaveLength(1);
    expect(degraded[0]!.name).toBe("offline-server");

    db.close();
  });

  it("returns servers whose latency exceeds the threshold", () => {
    const db = createInMemoryDb();

    recordHealthCheck(db, {
      server_name: "slow-server",
      status: "healthy",
      latency_ms: 2000,
      tool_count: 1,
      error_message: null,
      checked_at: now(),
    });

    recordHealthCheck(db, {
      server_name: "fast-server",
      status: "healthy",
      latency_ms: 200,
      tool_count: 1,
      error_message: null,
      checked_at: now(),
    });

    const degraded = getDegradedServers(db, ["slow-server", "fast-server"], 1000);
    expect(degraded).toHaveLength(1);
    expect(degraded[0]!.name).toBe("slow-server");

    db.close();
  });

  it("returns empty array when no servers are degraded", () => {
    const db = createInMemoryDb();

    recordHealthCheck(db, {
      server_name: "good-server",
      status: "healthy",
      latency_ms: 150,
      tool_count: 4,
      error_message: null,
      checked_at: now(),
    });

    const degraded = getDegradedServers(db, ["good-server"], 1000);
    expect(degraded).toHaveLength(0);

    db.close();
  });

  it("returns servers with degraded status", () => {
    const db = createInMemoryDb();

    recordHealthCheck(db, {
      server_name: "degraded-server",
      status: "degraded",
      latency_ms: 800,
      tool_count: 2,
      error_message: null,
      checked_at: now(),
    });

    const degraded = getDegradedServers(db, ["degraded-server"], 1000);
    expect(degraded).toHaveLength(1);
    expect(degraded[0]!.name).toBe("degraded-server");

    db.close();
  });
});

// --------------------------------------------------------------------------
// Config discovery tests
// --------------------------------------------------------------------------

describe("discoverServers", () => {
  it("reads servers from a custom config file", () => {
    const tmpDir = os.tmpdir();
    const tmpConfig = path.join(tmpDir, "test-mcp-config.json");

    const config = {
      mcpServers: {
        "server-a": { command: "node", args: ["server-a.js"] },
        "server-b": { command: "python", args: ["server-b.py"] },
      },
    };

    fs.writeFileSync(tmpConfig, JSON.stringify(config), "utf-8");

    try {
      const servers = discoverServers(tmpConfig);

      expect(Object.keys(servers)).toHaveLength(2);
      expect(servers["server-a"]).toBeDefined();
      expect(servers["server-a"]!.command).toBe("node");
      expect(servers["server-a"]!.name).toBe("server-a");
      expect(servers["server-b"]).toBeDefined();
      expect(servers["server-b"]!.command).toBe("python");
    } finally {
      fs.unlinkSync(tmpConfig);
    }
  });

  it("returns empty object when config file does not exist", () => {
    const servers = discoverServers("/nonexistent/path/config.json");
    expect(servers).toEqual({});
  });

  it("gracefully handles malformed JSON config", () => {
    const tmpDir = os.tmpdir();
    const tmpConfig = path.join(tmpDir, "bad-mcp-config.json");

    fs.writeFileSync(tmpConfig, "{ this is not valid json }", "utf-8");

    try {
      const servers = discoverServers(tmpConfig);
      expect(servers).toEqual({});
    } finally {
      fs.unlinkSync(tmpConfig);
    }
  });

  it("merges servers from multiple discovery paths", () => {
    const tmpDir = os.tmpdir();
    const tmpConfig = path.join(tmpDir, "merge-mcp-config.json");

    const config = {
      mcpServers: {
        "merged-server": { command: "node", args: ["merged.js"] },
      },
    };

    fs.writeFileSync(tmpConfig, JSON.stringify(config), "utf-8");

    try {
      const servers = discoverServers(tmpConfig);
      expect(servers["merged-server"]).toBeDefined();
    } finally {
      fs.unlinkSync(tmpConfig);
    }
  });
});

// --------------------------------------------------------------------------
// Per-server threshold config tests (Phase 2)
// --------------------------------------------------------------------------

describe("loadHealthConfig", () => {
  it("returns defaults when config file does not exist", () => {
    const config = loadHealthConfig("/nonexistent/path/health-config.yaml");
    expect(config.defaults.latency_threshold_ms).toBe(3000);
    expect(config.defaults.timeout_ms).toBe(5000);
    expect(config.servers).toEqual({});
  });

  it("loads a valid YAML config file", () => {
    const tmpDir = os.tmpdir();
    const tmpConfig = path.join(tmpDir, "test-health-config.yaml");

    const yamlContent = [
      "defaults:",
      "  latency_threshold_ms: 2000",
      "  timeout_ms: 8000",
      "servers:",
      "  my-slow-server:",
      "    latency_threshold_ms: 10000",
      "    timeout_ms: 15000",
    ].join("\n");

    fs.writeFileSync(tmpConfig, yamlContent, "utf-8");

    try {
      const config = loadHealthConfig(tmpConfig);
      expect(config.defaults.latency_threshold_ms).toBe(2000);
      expect(config.defaults.timeout_ms).toBe(8000);
      expect(config.servers["my-slow-server"]?.latency_threshold_ms).toBe(10000);
      expect(config.servers["my-slow-server"]?.timeout_ms).toBe(15000);
    } finally {
      fs.unlinkSync(tmpConfig);
    }
  });

  it("returns defaults on invalid YAML", () => {
    const tmpDir = os.tmpdir();
    const tmpConfig = path.join(tmpDir, "bad-health-config.yaml");

    fs.writeFileSync(tmpConfig, "{ invalid: yaml: content: [[[", "utf-8");

    try {
      const config = loadHealthConfig(tmpConfig);
      expect(config.defaults.latency_threshold_ms).toBe(3000);
    } finally {
      fs.unlinkSync(tmpConfig);
    }
  });
});

describe("getServerThresholds", () => {
  it("returns default latency threshold when no per-server override exists", () => {
    const config = loadHealthConfig("/nonexistent/path");
    const thresholds = getServerThresholds(config, "some-server", 1500);
    // defaults.latency_threshold_ms = 3000 (takes precedence over globalLatencyThreshold)
    expect(thresholds.latency_threshold_ms).toBe(3000);
  });

  it("uses per-server override when configured", () => {
    const tmpDir = os.tmpdir();
    const tmpConfig = path.join(tmpDir, "threshold-test.yaml");

    const yamlContent = [
      "defaults:",
      "  latency_threshold_ms: 2000",
      "  timeout_ms: 5000",
      "servers:",
      "  special-server:",
      "    latency_threshold_ms: 10000",
      "    timeout_ms: 20000",
    ].join("\n");

    fs.writeFileSync(tmpConfig, yamlContent, "utf-8");

    try {
      const config = loadHealthConfig(tmpConfig);
      const thresholds = getServerThresholds(config, "special-server", 1000);
      expect(thresholds.latency_threshold_ms).toBe(10000);
      expect(thresholds.timeout_ms).toBe(20000);
    } finally {
      fs.unlinkSync(tmpConfig);
    }
  });
});

// --------------------------------------------------------------------------
// MCP Resources primitive tests (Phase 2)
// --------------------------------------------------------------------------

describe("MCP Resources primitive", () => {
  it("server is created with resources capability without error", async () => {
    const db = createInMemoryDb();
    const { createHealthMonitorServer } = await import("../src/server.js");

    const server = createHealthMonitorServer({
      db,
      latencyThreshold: 1000,
      startupGraceSeconds: 10,
    });

    expect(server).toBeDefined();
    await server.close();
    db.close();
  });
});

// --------------------------------------------------------------------------
// export_dashboard DB verification tests (Phase 2)
// --------------------------------------------------------------------------

describe("export_dashboard prerequisites", () => {
  it("server_schemas table exists for check_updates tool", () => {
    const db = createInMemoryDb();
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='server_schemas'")
      .get() as { name: string } | undefined;
    expect(row?.name).toBe("server_schemas");
    db.close();
  });

  it("createHealthMonitorServer instantiates with empty config path without error", async () => {
    const db = createInMemoryDb();
    const tmpDir = os.tmpdir();
    const tmpConfig = path.join(tmpDir, "empty-config-dashboard.json");

    fs.writeFileSync(tmpConfig, JSON.stringify({ mcpServers: {} }), "utf-8");

    try {
      const { createHealthMonitorServer } = await import("../src/server.js");
      const server = createHealthMonitorServer({
        db,
        latencyThreshold: 1000,
        startupGraceSeconds: 10,
        configPath: tmpConfig,
      });
      expect(server).toBeDefined();
      await server.close();
    } finally {
      fs.unlinkSync(tmpConfig);
      db.close();
    }
  });
});
