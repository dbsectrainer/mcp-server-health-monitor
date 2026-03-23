import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ServerConfig } from "../src/auto-restart.js";

// --------------------------------------------------------------------------
// Mock child_process
// --------------------------------------------------------------------------

const mockChildProcess = {
  pid: 12345,
  on: vi.fn(),
  unref: vi.fn(),
};

vi.mock("child_process", () => ({
  spawn: vi.fn(() => mockChildProcess),
}));

import { spawn } from "child_process";
import { tryRestart } from "../src/auto-restart.js";

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function makeConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    name: "test-server",
    command: "node",
    args: ["server.js"],
    auto_restart: true,
    restart_max_attempts: 3,
    restart_backoff_ms: 0, // set to 0 to avoid actual delays in tests
    ...overrides,
  };
}

/**
 * Configures the mock child process to emit 'spawn' after setup.
 */
function setupSpawnSuccess(): void {
  mockChildProcess.on.mockImplementation((event: string, cb: () => void) => {
    if (event === "spawn") {
      setImmediate(cb);
    }
    return mockChildProcess;
  });
}

/**
 * Configures the mock child process to emit 'error'.
 */
function setupSpawnError(err: Error): void {
  mockChildProcess.on.mockImplementation((event: string, cb: (e: Error) => void) => {
    if (event === "error") {
      setImmediate(() => cb(err));
    }
    return mockChildProcess;
  });
}

// --------------------------------------------------------------------------
// Tests
// --------------------------------------------------------------------------

describe("tryRestart", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockChildProcess.pid = 12345;
    mockChildProcess.on.mockReturnValue(mockChildProcess);
    mockChildProcess.unref.mockReturnValue(undefined);
  });

  it("returns success with pid on successful spawn", async () => {
    setupSpawnSuccess();
    const config = makeConfig();

    const result = await tryRestart(config, 1);

    expect(result.success).toBe(true);
    expect(result.pid).toBe(12345);
    expect(result.attempt).toBe(1);
    expect(result.error).toBeUndefined();
  });

  it("calls spawn with the correct command and args", async () => {
    setupSpawnSuccess();
    const config = makeConfig({ command: "python", args: ["run.py", "--port", "3000"] });

    await tryRestart(config, 1);

    expect(spawn).toHaveBeenCalledWith("python", ["run.py", "--port", "3000"], expect.any(Object));
  });

  it("returns failure when max attempts are exceeded", async () => {
    const config = makeConfig({ restart_max_attempts: 3, restart_backoff_ms: 0 });

    const result = await tryRestart(config, 4); // attempt 4 > max 3

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/max restart attempts/i);
    expect(result.attempt).toBe(4);
    expect(spawn).not.toHaveBeenCalled();
  });

  it("returns failure on spawn error", async () => {
    setupSpawnError(new Error("ENOENT: command not found"));
    const config = makeConfig();

    const result = await tryRestart(config, 1);

    expect(result.success).toBe(false);
    expect(result.error).toContain("ENOENT");
    expect(result.attempt).toBe(1);
  });

  it("passes attempt number through to result", async () => {
    setupSpawnSuccess();
    const config = makeConfig();

    const result = await tryRestart(config, 2);

    expect(result.attempt).toBe(2);
  });

  it("uses default restart_max_attempts of 3 when not configured", async () => {
    // attempt > 3 (default) should fail without spawning
    const config: ServerConfig = {
      name: "minimal-server",
      command: "node",
      restart_backoff_ms: 0,
      // restart_max_attempts not set
    };

    const result = await tryRestart(config, 4);

    expect(result.success).toBe(false);
    expect(spawn).not.toHaveBeenCalled();
  });

  it("uses detached:true and stdio:ignore when spawning", async () => {
    setupSpawnSuccess();
    const config = makeConfig();

    await tryRestart(config, 1);

    expect(spawn).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({ detached: true, stdio: "ignore" }),
    );
  });

  it("calls unref on the child process after successful spawn", async () => {
    setupSpawnSuccess();
    const config = makeConfig();

    await tryRestart(config, 1);

    expect(mockChildProcess.unref).toHaveBeenCalled();
  });

  it("allows attempt 1 through when max_attempts is 1", async () => {
    setupSpawnSuccess();
    const config = makeConfig({ restart_max_attempts: 1 });

    const result = await tryRestart(config, 1);

    expect(result.success).toBe(true);
  });

  it("blocks attempt 2 when max_attempts is 1", async () => {
    const config = makeConfig({ restart_max_attempts: 1, restart_backoff_ms: 0 });

    const result = await tryRestart(config, 2);

    expect(result.success).toBe(false);
    expect(spawn).not.toHaveBeenCalled();
  });
});
