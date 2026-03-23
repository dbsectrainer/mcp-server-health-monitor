import { describe, it, expect, afterAll } from "vitest";
import Database from "better-sqlite3";
import {
  openDatabase,
  recordHealthCheck,
  getDegradedServers,
  getLatencyPercentiles,
  recordServerSchema,
  getLastSchema,
  getServerHistory,
} from "../src/db.js";
import { probeServer } from "../src/probes/mcp-probe.js";
import type { McpServerEntry } from "../src/types.js";

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function createInMemoryDb(): Database.Database {
  return openDatabase(":memory:");
}

// --------------------------------------------------------------------------
// Probe tests
// --------------------------------------------------------------------------

describe("probeServer", () => {
  it("returns offline for a server with no command configured", async () => {
    const server: McpServerEntry = {
      name: "no-command-server",
      // command deliberately omitted
    };

    const result = await probeServer(server, 2000);
    expect(result.status).toBe("offline");
    expect(result.latencyMs).toBeNull();
    expect(result.message).toMatch(/no command/i);
  });

  it("returns offline for a non-existent command", async () => {
    const server: McpServerEntry = {
      name: "fake-server",
      command: "this-command-does-not-exist-abc123xyz",
      args: [],
    };

    const result = await probeServer(server, 3000);
    expect(result.status).toBe("offline");
    expect(result.latencyMs).not.toBeNull();
  }, 10000);

  it("returns offline when probe times out", async () => {
    // Use a command that hangs (e.g., `sleep 60`), with a very short timeout
    const server: McpServerEntry = {
      name: "slow-server",
      command: "sleep",
      args: ["60"],
    };

    const result = await probeServer(server, 300);
    expect(result.status).toBe("offline");
    expect(result.message).toMatch(/timed out/i);
  }, 5000);
});

// --------------------------------------------------------------------------
// list_degraded integration tests using mocked health data
// --------------------------------------------------------------------------

describe("list_degraded with mocked health data", () => {
  it("filters degraded servers from a mixed set", () => {
    const db = createInMemoryDb();
    const now = Date.now();

    // healthy server
    recordHealthCheck(db, {
      server_name: "good-server",
      status: "healthy",
      latency_ms: 150,
      tool_count: 3,
      error_message: null,
      checked_at: now,
    });

    // offline server
    recordHealthCheck(db, {
      server_name: "bad-server",
      status: "offline",
      latency_ms: null,
      tool_count: null,
      error_message: "Connection refused",
      checked_at: now,
    });

    // high-latency server (above 1000ms threshold)
    recordHealthCheck(db, {
      server_name: "slow-server",
      status: "healthy",
      latency_ms: 1500,
      tool_count: 2,
      error_message: null,
      checked_at: now,
    });

    const degraded = getDegradedServers(db, ["good-server", "bad-server", "slow-server"], 1000);

    expect(degraded).toHaveLength(2);
    const names = degraded.map((d) => d.name);
    expect(names).toContain("bad-server");
    expect(names).toContain("slow-server");
    expect(names).not.toContain("good-server");

    db.close();
  });

  it("shows all servers healthy when no degraded servers exist", () => {
    const db = createInMemoryDb();
    const now = Date.now();

    const serverNames = ["alpha", "beta", "gamma"];
    for (const name of serverNames) {
      recordHealthCheck(db, {
        server_name: name,
        status: "healthy",
        latency_ms: 100,
        tool_count: 5,
        error_message: null,
        checked_at: now,
      });
    }

    const degraded = getDegradedServers(db, serverNames, 1000);
    expect(degraded).toHaveLength(0);

    db.close();
  });

  it("respects custom latency threshold", () => {
    const db = createInMemoryDb();
    const now = Date.now();

    recordHealthCheck(db, {
      server_name: "borderline-server",
      status: "healthy",
      latency_ms: 600,
      tool_count: 1,
      error_message: null,
      checked_at: now,
    });

    // With 1000ms threshold — should NOT be degraded
    const resultLenient = getDegradedServers(db, ["borderline-server"], 1000);
    expect(resultLenient).toHaveLength(0);

    // With 500ms threshold — SHOULD be degraded
    const resultStrict = getDegradedServers(db, ["borderline-server"], 500);
    expect(resultStrict).toHaveLength(1);

    db.close();
  });
});

// --------------------------------------------------------------------------
// Latency percentile tests (Phase 2)
// --------------------------------------------------------------------------

describe("getLatencyPercentiles", () => {
  it("returns null percentiles for server with no records", () => {
    const db = createInMemoryDb();
    const result = getLatencyPercentiles(db, "nonexistent", 24);
    expect(result.p50).toBeNull();
    expect(result.p95).toBeNull();
    expect(result.sample_count).toBe(0);
    db.close();
  });

  it("calculates p50 and p95 from latency values", () => {
    const db = createInMemoryDb();
    const now = Date.now();

    // Insert 20 latency values: 100, 200, ..., 2000
    for (let i = 1; i <= 20; i++) {
      recordHealthCheck(db, {
        server_name: "test-server",
        status: "healthy",
        latency_ms: i * 100,
        tool_count: 1,
        error_message: null,
        checked_at: now - i * 1000,
      });
    }

    const result = getLatencyPercentiles(db, "test-server", 24);
    expect(result.sample_count).toBe(20);
    expect(result.p50).not.toBeNull();
    expect(result.p95).not.toBeNull();
    // p50 index = floor(20 * 0.5) = 10, sorted asc [100..2000], index 10 = 1100
    expect(result.p50).toBe(1100);
    // p95 index = min(floor(20 * 0.95), 19) = min(19, 19) = 19, value = 2000
    expect(result.p95).toBe(2000);
    db.close();
  });

  it("excludes records outside the time window", () => {
    const db = createInMemoryDb();
    const now = Date.now();
    const hoursAgo = 25 * 60 * 60 * 1000;

    // Old record outside 24h window
    recordHealthCheck(db, {
      server_name: "test-server",
      status: "healthy",
      latency_ms: 999,
      tool_count: 1,
      error_message: null,
      checked_at: now - hoursAgo,
    });

    const result = getLatencyPercentiles(db, "test-server", 24);
    expect(result.sample_count).toBe(0);
    expect(result.p50).toBeNull();
    db.close();
  });

  it("handles servers with only null latency values", () => {
    const db = createInMemoryDb();
    const now = Date.now();

    recordHealthCheck(db, {
      server_name: "offline-server",
      status: "offline",
      latency_ms: null,
      tool_count: null,
      error_message: "Connection refused",
      checked_at: now,
    });

    const result = getLatencyPercentiles(db, "offline-server", 24);
    expect(result.sample_count).toBe(0);
    expect(result.p50).toBeNull();
    db.close();
  });
});

// --------------------------------------------------------------------------
// check_updates / schema tracking tests (Phase 2)
// --------------------------------------------------------------------------

describe("recordServerSchema and getLastSchema", () => {
  it("returns null for a server with no schema", () => {
    const db = createInMemoryDb();
    const result = getLastSchema(db, "no-schema-server");
    expect(result).toBeNull();
    db.close();
  });

  it("stores and retrieves a schema record", () => {
    const db = createInMemoryDb();
    const capturedAt = Date.now();

    recordServerSchema(db, {
      server_name: "my-server",
      schema_hash: "abc123",
      schema_json: '{"tool_count":5}',
      captured_at: capturedAt,
    });

    const result = getLastSchema(db, "my-server");
    expect(result).not.toBeNull();
    expect(result!.server_name).toBe("my-server");
    expect(result!.schema_hash).toBe("abc123");
    expect(result!.schema_json).toBe('{"tool_count":5}');
    expect(result!.captured_at).toBe(capturedAt);
    db.close();
  });

  it("returns the most recent schema when multiple records exist", () => {
    const db = createInMemoryDb();
    const now = Date.now();

    recordServerSchema(db, {
      server_name: "evolving-server",
      schema_hash: "old-hash",
      schema_json: '{"tool_count":3}',
      captured_at: now - 5000,
    });

    recordServerSchema(db, {
      server_name: "evolving-server",
      schema_hash: "new-hash",
      schema_json: '{"tool_count":5}',
      captured_at: now,
    });

    const result = getLastSchema(db, "evolving-server");
    expect(result!.schema_hash).toBe("new-hash");
    db.close();
  });

  it("detects schema change when hash differs", () => {
    const db = createInMemoryDb();
    const now = Date.now();

    recordServerSchema(db, {
      server_name: "changing-server",
      schema_hash: "v1-hash",
      schema_json: '{"tool_count":2}',
      captured_at: now - 1000,
    });

    const lastSchema = getLastSchema(db, "changing-server");
    const hasChanged = lastSchema !== null && lastSchema.schema_hash !== "v2-hash";
    expect(hasChanged).toBe(true);
    db.close();
  });

  it("detects no change when schema hash is the same", () => {
    const db = createInMemoryDb();
    const now = Date.now();

    recordServerSchema(db, {
      server_name: "stable-server",
      schema_hash: "stable-hash",
      schema_json: '{"tool_count":3}',
      captured_at: now,
    });

    const lastSchema = getLastSchema(db, "stable-server");
    const hasChanged = lastSchema !== null && lastSchema.schema_hash !== "stable-hash";
    expect(hasChanged).toBe(false);
    db.close();
  });
});

// --------------------------------------------------------------------------
// getServerHistory tests (Phase 2)
// --------------------------------------------------------------------------

describe("getServerHistory", () => {
  it("returns empty array for unknown server", () => {
    const db = createInMemoryDb();
    const result = getServerHistory(db, "ghost-server", 50);
    expect(result).toHaveLength(0);
    db.close();
  });

  it("returns up to the limit of records in descending order", () => {
    const db = createInMemoryDb();
    const now = Date.now();

    for (let i = 0; i < 30; i++) {
      recordHealthCheck(db, {
        server_name: "history-server",
        status: "healthy",
        latency_ms: 100 + i,
        tool_count: 1,
        error_message: null,
        checked_at: now - i * 1000,
      });
    }

    const result = getServerHistory(db, "history-server", 10);
    expect(result).toHaveLength(10);
    // Most recent first
    expect(result[0]!.checked_at).toBeGreaterThan(result[9]!.checked_at);
    db.close();
  });

  it("returns all records if count is below the limit", () => {
    const db = createInMemoryDb();
    const now = Date.now();

    for (let i = 0; i < 5; i++) {
      recordHealthCheck(db, {
        server_name: "small-history-server",
        status: "healthy",
        latency_ms: 200,
        tool_count: 1,
        error_message: null,
        checked_at: now - i * 1000,
      });
    }

    const result = getServerHistory(db, "small-history-server", 50);
    expect(result).toHaveLength(5);
    db.close();
  });
});
