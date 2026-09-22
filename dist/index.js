#!/usr/bin/env node
import * as os from "os";
import * as fs from "fs";
import * as path from "path";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { openDatabase } from "./db.js";
import { startServer } from "./server.js";
import { startHttpServer } from "./http-server.js";
import { discoverServers } from "./config-discovery.js";
import { recordHealthCheck } from "./db.js";
import { probeServer } from "./probes/mcp-probe.js";
function expandTilde(filePath) {
    if (filePath.startsWith("~/") || filePath === "~") {
        return path.join(os.homedir(), filePath.slice(2));
    }
    return filePath;
}
async function main() {
    const argv = await yargs(hideBin(process.argv))
        .option("interval", {
        type: "number",
        default: 60,
        description: "Poll interval in seconds (used with --daemon)",
    })
        .option("latency-threshold", {
        type: "number",
        default: 1000,
        description: "Latency in ms above which a server is marked degraded",
    })
        .option("db", {
        type: "string",
        default: "~/.mcp/health.db",
        description: "Path to SQLite database file",
    })
        .option("startup-grace-seconds", {
        type: "number",
        default: 10,
        description: "Grace period in seconds before a newly seen server is counted as offline",
    })
        .option("config", {
        type: "string",
        description: "Custom path to MCP config file",
    })
        .option("daemon", {
        type: "boolean",
        default: false,
        description: "Run as background polling daemon (uses --interval for poll frequency)",
    })
        .option("http-port", {
        type: "number",
        default: 0,
        description: "Port for Streamable HTTP transport (0 = disabled, uses stdio instead)",
    })
        .option("health-config", {
        type: "string",
        description: "Custom path to per-server health thresholds YAML (default: ~/.mcp/health-config.yaml)",
    })
        .help()
        .parseAsync();
    const dbPath = expandTilde(argv.db);
    const dbDir = path.dirname(dbPath);
    // Ensure the database directory exists
    if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
    }
    const db = openDatabase(dbPath);
    console.error(`[mcp-server-health-monitor] Using database: ${dbPath}`);
    const configPath = argv.config ? expandTilde(argv.config) : undefined;
    const healthConfigPath = argv["health-config"] ? expandTilde(argv["health-config"]) : undefined;
    const manualServersPath = path.join(dbDir, "extra-servers.json");
    const serverOptions = {
        db,
        latencyThreshold: argv["latency-threshold"],
        startupGraceSeconds: argv["startup-grace-seconds"],
        configPath,
        healthConfigPath,
        manualServersPath,
    };
    // ------------------------------------------------------------------
    // Daemon mode: background polling
    // ------------------------------------------------------------------
    if (argv.daemon) {
        console.error(`[mcp-server-health-monitor] Daemon mode enabled — polling every ${argv.interval}s`);
        let running = true;
        const shutdown = () => {
            running = false;
            console.error("[mcp-server-health-monitor] Daemon shutting down...");
            db.close();
            process.exit(0);
        };
        process.on("SIGINT", shutdown);
        process.on("SIGTERM", shutdown);
        // Run an initial check immediately, then poll on interval
        const runCheck = async () => {
            const servers = discoverServers(configPath);
            const now = Date.now();
            for (const [serverName, entry] of Object.entries(servers)) {
                // Skip self
                const cmd = entry.command ?? "";
                if (cmd.includes("mcp-server-health-monitor"))
                    continue;
                try {
                    const result = await probeServer(entry, 5000);
                    let status = result.status;
                    if (status === "healthy" &&
                        result.latencyMs !== null &&
                        result.latencyMs > argv["latency-threshold"]) {
                        status = "degraded";
                    }
                    recordHealthCheck(db, {
                        server_name: serverName,
                        status,
                        latency_ms: result.latencyMs,
                        tool_count: result.toolCount,
                        error_message: result.message ?? null,
                        checked_at: now,
                    });
                    console.error(`[mcp-server-health-monitor] ${serverName}: ${status} (${result.latencyMs ?? "N/A"}ms)`);
                }
                catch (err) {
                    console.error(`[mcp-server-health-monitor] ${serverName}: probe error — ${String(err)}`);
                    recordHealthCheck(db, {
                        server_name: serverName,
                        status: "offline",
                        latency_ms: null,
                        tool_count: null,
                        error_message: String(err),
                        checked_at: now,
                    });
                }
            }
        };
        await runCheck();
        const intervalMs = argv.interval * 1000;
        const timer = setInterval(async () => {
            if (!running) {
                clearInterval(timer);
                return;
            }
            await runCheck();
        }, intervalMs);
        // Keep process alive
        await new Promise(() => {
            // never resolves — daemon runs until signal
        });
        return;
    }
    // ------------------------------------------------------------------
    // HTTP transport mode
    // ------------------------------------------------------------------
    if (argv["http-port"] && argv["http-port"] > 0) {
        await startHttpServer(serverOptions, argv["http-port"]);
        return;
    }
    // ------------------------------------------------------------------
    // Default: stdio MCP server
    // ------------------------------------------------------------------
    await startServer(serverOptions);
}
main().catch((err) => {
    console.error("[mcp-server-health-monitor] Fatal error:", err);
    process.exit(1);
});
