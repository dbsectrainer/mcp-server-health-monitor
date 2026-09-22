import * as crypto from "crypto";
import * as fs from "fs";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, ListResourcesRequestSchema, ReadResourceRequestSchema, CancelledNotificationSchema, McpError, ErrorCode, } from "@modelcontextprotocol/sdk/types.js";
import { discoverServers } from "./config-discovery.js";
import { recordHealthCheck, getServerStatus, getAllServerStatuses, getLatencyPercentiles, recordServerSchema, getLastSchema, getServerHistory, } from "./db.js";
import { probeServer } from "./probes/mcp-probe.js";
import { loadHealthConfig, getServerThresholds } from "./health-config.js";
// ── Manual server registry helpers ────────────────────────────────────────────
function loadManualServers(filePath) {
    try {
        if (fs.existsSync(filePath)) {
            const raw = fs.readFileSync(filePath, "utf-8");
            return JSON.parse(raw);
        }
    }
    catch {
        // Corrupted file — treat as empty
    }
    return {};
}
function saveManualServers(filePath, servers) {
    fs.writeFileSync(filePath, JSON.stringify(servers, null, 2), "utf-8");
}
function mergeManualServers(discovered, manualServersPath) {
    if (!manualServersPath)
        return discovered;
    const manual = loadManualServers(manualServersPath);
    const merged = { ...discovered };
    for (const [name, entry] of Object.entries(manual)) {
        if (!(name in merged)) {
            merged[name] = { ...entry, name };
        }
    }
    return merged;
}
/**
 * Determine if a given server entry refers to this health monitor process itself.
 * We skip self-monitoring to avoid infinite loops.
 */
function isSelf(server) {
    const argv = process.argv;
    // If the command is "node" and one of the args matches our script path
    // or if the command directly matches our executable name
    const cmd = server.command ?? "";
    const args = server.args ?? [];
    if (cmd === "node" || cmd === "tsx") {
        const scriptArg = args.find((a) => a.includes("mcp-server-health-monitor"));
        if (scriptArg)
            return true;
    }
    if (cmd.includes("mcp-server-health-monitor"))
        return true;
    // Check if npx invocation targets us
    if (cmd === "npx" || cmd === "npx.cmd") {
        const targetArg = args.find((a) => a.includes("mcp-server-health-monitor"));
        if (targetArg)
            return true;
    }
    // Compare against current process argv
    const currentScript = argv[1] ?? "";
    if (currentScript && args.some((a) => a === currentScript))
        return true;
    return false;
}
function hashSchema(toolsJson) {
    return crypto.createHash("sha256").update(toolsJson).digest("hex").slice(0, 16);
}
function generateSparkline(history) {
    // Render last 24 checks as inline SVG bars
    const barWidth = 6;
    const barGap = 1;
    const maxHeight = 20;
    const width = history.length * (barWidth + barGap);
    const svgHeight = maxHeight + 4;
    const maxLatency = Math.max(1, ...history.map((h) => h.latency_ms ?? 0));
    const bars = history
        .map((h, i) => {
        const x = i * (barWidth + barGap);
        let color = "#ef4444"; // offline = red
        let barH = 4;
        if (h.status === "healthy") {
            color = "#22c55e"; // green
            barH = Math.max(4, Math.round(((h.latency_ms ?? 0) / maxLatency) * maxHeight));
        }
        else if (h.status === "degraded") {
            color = "#f59e0b"; // amber
            barH = Math.max(4, Math.round(((h.latency_ms ?? 0) / maxLatency) * maxHeight));
        }
        const y = svgHeight - barH;
        return `<rect x="${x}" y="${y}" width="${barWidth}" height="${barH}" fill="${color}" rx="1"/>`;
    })
        .join("");
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${svgHeight}" viewBox="0 0 ${width} ${svgHeight}">${bars}</svg>`;
}
function generateDashboardHtml(statuses, generatedAt) {
    const healthy = statuses.filter((s) => s.status === "healthy").length;
    const degraded = statuses.filter((s) => s.status === "degraded").length;
    const offline = statuses.filter((s) => s.status === "offline" || s.status === "unknown").length;
    const total = statuses.length;
    const statusBadge = (status) => {
        const colors = {
            healthy: "background:#dcfce7;color:#166534;",
            degraded: "background:#fef9c3;color:#854d0e;",
            offline: "background:#fee2e2;color:#991b1b;",
            unknown: "background:#f3f4f6;color:#6b7280;",
        };
        const style = colors[status] ?? colors["unknown"];
        return `<span style="padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600;${style}">${status}</span>`;
    };
    const formatMs = (ms) => (ms !== null ? `${ms}ms` : "—");
    const formatDate = (ts) => (ts ? new Date(ts).toLocaleString() : "Never");
    const tableRows = statuses
        .map((s) => `
      <tr>
        <td style="padding:10px 12px;font-weight:500;">${s.name}</td>
        <td style="padding:10px 12px;">${statusBadge(s.status)}</td>
        <td style="padding:10px 12px;text-align:right;">${formatMs(s.latency_ms)}</td>
        <td style="padding:10px 12px;text-align:right;">${formatMs(s.p50)}</td>
        <td style="padding:10px 12px;text-align:right;">${formatMs(s.p95)}</td>
        <td style="padding:10px 12px;color:#6b7280;font-size:13px;">${formatDate(s.last_seen)}</td>
        <td style="padding:10px 12px;">${generateSparkline(s.history)}</td>
      </tr>`)
        .join("");
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>MCP Server Health Dashboard</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f9fafb; color: #111827; min-height: 100vh; padding: 24px; }
  h1 { font-size: 22px; font-weight: 700; margin-bottom: 4px; }
  .subtitle { color: #6b7280; font-size: 13px; margin-bottom: 24px; }
  .cards { display: flex; gap: 16px; margin-bottom: 28px; flex-wrap: wrap; }
  .card { background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 18px 24px; min-width: 140px; }
  .card-label { font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: .05em; margin-bottom: 6px; }
  .card-value { font-size: 28px; font-weight: 700; }
  .card-value.healthy { color: #16a34a; }
  .card-value.degraded { color: #d97706; }
  .card-value.offline { color: #dc2626; }
  .card-value.total { color: #1d4ed8; }
  table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; overflow: hidden; }
  thead { background: #f3f4f6; }
  th { padding: 10px 12px; text-align: left; font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: .05em; font-weight: 600; }
  th:nth-child(n+3):nth-child(-n+5) { text-align: right; }
  tbody tr:hover { background: #f9fafb; }
  tbody tr + tr { border-top: 1px solid #f3f4f6; }
  footer { margin-top: 20px; font-size: 12px; color: #9ca3af; text-align: right; }
</style>
</head>
<body>
<h1>MCP Server Health Dashboard</h1>
<p class="subtitle">Generated at ${generatedAt.toLocaleString()}</p>
<div class="cards">
  <div class="card"><div class="card-label">Total</div><div class="card-value total">${total}</div></div>
  <div class="card"><div class="card-label">Healthy</div><div class="card-value healthy">${healthy}</div></div>
  <div class="card"><div class="card-label">Degraded</div><div class="card-value degraded">${degraded}</div></div>
  <div class="card"><div class="card-label">Offline</div><div class="card-value offline">${offline}</div></div>
</div>
<table>
  <thead>
    <tr>
      <th>Server</th>
      <th>Status</th>
      <th>Last Latency</th>
      <th>p50</th>
      <th>p95</th>
      <th>Last Checked</th>
      <th>Sparkline (last 24)</th>
    </tr>
  </thead>
  <tbody>
    ${tableRows}
  </tbody>
</table>
<footer>mcp-server-health-monitor v0.2.0</footer>
</body>
</html>`;
}
export function createHealthMonitorServer(options) {
    const { db, latencyThreshold, startupGraceSeconds, configPath, healthConfigPath, manualServersPath, } = options;
    const getAllServers = () => mergeManualServers(discoverServers(configPath), manualServersPath);
    let healthConfig = loadHealthConfig(healthConfigPath);
    // Cancellation flag for health_check_all
    let cancelHealthCheck = false;
    const server = new Server({ name: "mcp-server-health-monitor", version: "0.2.0" }, { capabilities: { tools: {}, resources: {} } });
    // Handle cancellation notifications
    server.setNotificationHandler(CancelledNotificationSchema, async () => {
        cancelHealthCheck = true;
    });
    // -------------------------------------------------------------------------
    // Resources: list
    // -------------------------------------------------------------------------
    server.setRequestHandler(ListResourcesRequestSchema, async () => {
        const servers = getAllServers();
        const serverNames = Object.keys(servers).filter((n) => !isSelf(servers[n]));
        return {
            resources: serverNames.map((name) => ({
                uri: `health://${name}`,
                name: `Health history for ${name}`,
                description: `Full health check history for MCP server "${name}"`,
                mimeType: "application/json",
            })),
        };
    });
    // -------------------------------------------------------------------------
    // Resources: read
    // -------------------------------------------------------------------------
    server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
        const uri = request.params.uri;
        const match = uri.match(/^health:\/\/(.+)$/);
        if (!match) {
            throw new McpError(ErrorCode.InvalidParams, `Invalid resource URI: ${uri}`);
        }
        const serverName = match[1];
        const history = getServerHistory(db, serverName, 50);
        return {
            contents: [
                {
                    uri,
                    mimeType: "application/json",
                    text: JSON.stringify({ server_name: serverName, history }, null, 2),
                },
            ],
        };
    });
    // -------------------------------------------------------------------------
    // Tools: list
    // -------------------------------------------------------------------------
    server.setRequestHandler(ListToolsRequestSchema, async () => {
        return {
            tools: [
                {
                    name: "health_check_all",
                    description: "Ping every configured MCP server via list_tools, measure latency, and store results. Returns a summary of all servers.",
                    annotations: { readOnlyHint: true },
                    inputSchema: {
                        type: "object",
                        properties: {
                            timeout_ms: {
                                type: "number",
                                description: "Per-server probe timeout in milliseconds (default: 5000). Example: 5000",
                            },
                        },
                        additionalProperties: false,
                    },
                },
                {
                    name: "get_server_status",
                    description: "Get detailed health status for a specific MCP server by name.",
                    annotations: { readOnlyHint: true },
                    inputSchema: {
                        type: "object",
                        properties: {
                            server_name: {
                                type: "string",
                                description: "The name of the MCP server to query. Example: 'filesystem' (use the key from your MCP config)",
                            },
                        },
                        required: ["server_name"],
                        additionalProperties: false,
                    },
                },
                {
                    name: "list_degraded",
                    description: "List all MCP servers that are offline or have latency above the threshold.",
                    annotations: { readOnlyHint: true },
                    inputSchema: {
                        type: "object",
                        properties: {
                            latency_threshold: {
                                type: "number",
                                description: "Override latency threshold in ms (default: configured threshold). Example: 2000 (flag servers slower than 2 seconds)",
                            },
                        },
                        additionalProperties: false,
                    },
                },
                {
                    name: "check_updates",
                    description: "Compare current tool schemas against last stored schemas to detect version drift across MCP servers.",
                    annotations: { readOnlyHint: true },
                    inputSchema: {
                        type: "object",
                        properties: {
                            timeout_ms: {
                                type: "number",
                                description: "Per-server probe timeout in milliseconds. Example: 5000",
                            },
                        },
                        additionalProperties: false,
                    },
                },
                {
                    name: "export_dashboard",
                    description: "Generate a self-contained HTML health dashboard with server status, latency trends, and uptime sparklines.",
                    annotations: { readOnlyHint: true },
                    inputSchema: {
                        type: "object",
                        properties: {
                            output_path: {
                                type: "string",
                                description: "Optional file path to write the HTML output. Example: '~/Desktop/mcp-health.html'. If omitted, HTML is returned as text.",
                            },
                        },
                        additionalProperties: false,
                    },
                },
                {
                    name: "get_history",
                    description: "Return the raw health check history for a specific MCP server, ordered most-recent first.",
                    annotations: { readOnlyHint: true },
                    inputSchema: {
                        type: "object",
                        properties: {
                            server_name: {
                                type: "string",
                                description: "Name of the MCP server to retrieve history for.",
                            },
                            limit: {
                                type: "number",
                                description: "Maximum number of records to return (default: 50, max: 500).",
                            },
                        },
                        required: ["server_name"],
                        additionalProperties: false,
                    },
                },
                {
                    name: "configure_server",
                    description: "Register a new MCP server to monitor. Servers added this way are stored in a supplementary config file alongside the database and are merged with servers discovered from Claude's config. Use this to monitor servers not present in Claude Desktop's config.",
                    annotations: { readOnlyHint: false, destructiveHint: false },
                    inputSchema: {
                        type: "object",
                        properties: {
                            name: {
                                type: "string",
                                description: "Unique name for the server. Example: 'my-custom-server'",
                            },
                            command: {
                                type: "string",
                                description: "Command to launch the server. Example: 'node'",
                            },
                            args: {
                                type: "array",
                                items: { type: "string" },
                                description: "Arguments to pass to the command. Example: ['/path/to/server.js']",
                            },
                            env: {
                                type: "object",
                                description: "Optional environment variables to set when launching the server.",
                                additionalProperties: { type: "string" },
                            },
                        },
                        required: ["name", "command"],
                        additionalProperties: false,
                    },
                },
                {
                    name: "remove_server",
                    description: "Remove a manually configured MCP server from monitoring. Only affects servers added via configure_server — servers discovered from Claude's config are not affected.",
                    annotations: { readOnlyHint: false, destructiveHint: true },
                    inputSchema: {
                        type: "object",
                        properties: {
                            name: {
                                type: "string",
                                description: "Name of the server to remove.",
                            },
                        },
                        required: ["name"],
                        additionalProperties: false,
                    },
                },
            ],
        };
    });
    // -------------------------------------------------------------------------
    // Tools: call
    // -------------------------------------------------------------------------
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const { name, arguments: args } = request.params;
        // Reload config on each call so live changes are picked up
        healthConfig = loadHealthConfig(healthConfigPath);
        // ------------------------------------------------------------------
        // health_check_all
        // ------------------------------------------------------------------
        if (name === "health_check_all") {
            cancelHealthCheck = false;
            const timeoutMs = args?.timeout_ms ?? 5000;
            const servers = getAllServers();
            const filteredServers = Object.entries(servers).filter(([, entry]) => !isSelf(entry));
            const total = filteredServers.length;
            const now = Date.now();
            const serverSummaries = [];
            for (let i = 0; i < filteredServers.length; i++) {
                // Check cancellation between probes
                if (cancelHealthCheck) {
                    await server.sendLoggingMessage({
                        level: "info",
                        data: `health_check_all cancelled after ${i} of ${total} servers`,
                    });
                    break;
                }
                const [serverName, entry] = filteredServers[i];
                const thresholds = getServerThresholds(healthConfig, serverName, latencyThreshold);
                const perServerTimeout = thresholds.timeout_ms;
                // Emit debug log per server
                await server.sendLoggingMessage({
                    level: "debug",
                    data: `Probing server: ${serverName} (timeout: ${perServerTimeout}ms)`,
                });
                // Emit progress notification
                try {
                    await server.notification({
                        method: "notifications/progress",
                        params: {
                            progressToken: "health_check_all",
                            progress: i + 1,
                            total,
                            message: `Probing ${serverName}`,
                        },
                    });
                }
                catch {
                    // Suppress if client doesn't support progress
                }
                let probeEntry;
                try {
                    const result = await probeServer(entry, Math.min(timeoutMs, perServerTimeout));
                    // Get previous status for transition detection
                    const prevStatus = getServerStatus(db, serverName);
                    // Apply per-server latency threshold
                    let status = result.status;
                    if (status === "healthy" &&
                        result.latencyMs !== null &&
                        result.latencyMs > thresholds.latency_threshold_ms) {
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
                    // Emit state transition notifications
                    if (prevStatus) {
                        const prev = prevStatus.status;
                        if (prev === "healthy" && (status === "degraded" || status === "offline")) {
                            await server.sendLoggingMessage({
                                level: "info",
                                data: `Server "${serverName}" transitioned: ${prev} → ${status}`,
                            });
                        }
                        else if ((prev === "degraded" || prev === "offline") && status === "healthy") {
                            await server.sendLoggingMessage({
                                level: "info",
                                data: `Server "${serverName}" recovered: ${prev} → healthy`,
                            });
                        }
                    }
                    probeEntry = {
                        name: serverName,
                        status,
                        latency_ms: result.latencyMs,
                        tool_count: result.toolCount,
                    };
                }
                catch (err) {
                    recordHealthCheck(db, {
                        server_name: serverName,
                        status: "offline",
                        latency_ms: null,
                        tool_count: null,
                        error_message: String(err),
                        checked_at: now,
                    });
                    probeEntry = {
                        name: serverName,
                        status: "offline",
                        latency_ms: null,
                        tool_count: null,
                    };
                }
                serverSummaries.push(probeEntry);
            }
            const summary = {
                healthy: serverSummaries.filter((s) => s.status === "healthy").length,
                degraded: serverSummaries.filter((s) => s.status === "degraded").length,
                offline: serverSummaries.filter((s) => s.status === "offline").length,
                total: serverSummaries.length,
            };
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({ servers: serverSummaries, summary }, null, 2),
                    },
                ],
            };
        }
        // ------------------------------------------------------------------
        // get_server_status
        // ------------------------------------------------------------------
        if (name === "get_server_status") {
            const typedArgs = args;
            const serverName = typedArgs?.server_name;
            if (!serverName || typeof serverName !== "string") {
                throw new McpError(ErrorCode.InvalidParams, "server_name is required and must be a string");
            }
            const knownServers = getAllServers();
            if (!(serverName in knownServers)) {
                throw new McpError(ErrorCode.InvalidParams, `Unknown server: "${serverName}". Run health_check_all to discover servers.`);
            }
            const status = getServerStatus(db, serverName);
            const percentiles = getLatencyPercentiles(db, serverName, 24);
            if (!status) {
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify({
                                name: serverName,
                                status: "unknown",
                                latency_ms: null,
                                tool_count: null,
                                last_seen: null,
                                error_count: 0,
                                last_error: null,
                                latency_percentiles: percentiles,
                                message: "Server discovered but not yet probed. Run health_check_all first.",
                            }, null, 2),
                        },
                    ],
                };
            }
            // Apply startup grace period
            const graceMs = startupGraceSeconds * 1000;
            const serverFirstSeen = db
                .prepare(`SELECT MIN(checked_at) as first_seen FROM health_checks WHERE server_name = ?`)
                .get(serverName);
            if (serverFirstSeen &&
                Date.now() - serverFirstSeen.first_seen < graceMs &&
                status.status === "offline") {
                const adjustedStatus = {
                    ...status,
                    status: "unknown",
                    latency_percentiles: percentiles,
                    message: `Within startup grace period (${startupGraceSeconds}s)`,
                };
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify(adjustedStatus, null, 2),
                        },
                    ],
                };
            }
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({ ...status, latency_percentiles: percentiles }, null, 2),
                    },
                ],
            };
        }
        // ------------------------------------------------------------------
        // list_degraded
        // ------------------------------------------------------------------
        if (name === "list_degraded") {
            const typedArgs = args;
            const threshold = typedArgs?.latency_threshold ?? latencyThreshold;
            const knownServers = getAllServers();
            const serverNames = Object.keys(knownServers).filter((n) => !isSelf(knownServers[n]));
            // Apply per-server thresholds
            const degraded = serverNames
                .map((n) => getServerStatus(db, n) ?? {
                name: n,
                status: "unknown",
                latency_ms: null,
                tool_count: null,
                last_seen: null,
                error_count: 0,
                last_error: null,
            })
                .filter((s) => {
                const perServerThreshold = getServerThresholds(healthConfig, s.name, threshold).latency_threshold_ms;
                if (s.status === "offline" || s.status === "degraded")
                    return true;
                if (s.latency_ms !== null && s.latency_ms > perServerThreshold)
                    return true;
                return false;
            });
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({
                            degraded_servers: degraded,
                            total_degraded: degraded.length,
                            latency_threshold_ms: threshold,
                        }, null, 2),
                    },
                ],
            };
        }
        // ------------------------------------------------------------------
        // check_updates
        // ------------------------------------------------------------------
        if (name === "check_updates") {
            const timeoutMs = args?.timeout_ms ?? 5000;
            const servers = getAllServers();
            const filteredServers = Object.entries(servers).filter(([, entry]) => !isSelf(entry));
            const results = await Promise.allSettled(filteredServers.map(async ([serverName, entry]) => {
                try {
                    const result = await probeServer(entry, timeoutMs);
                    if (result.status === "offline") {
                        return {
                            name: serverName,
                            has_changed: false,
                            previous_hash: null,
                            current_hash: null,
                            changed_at: null,
                            error: result.message ?? "offline",
                        };
                    }
                    // Hash the full tool schemas (name + description + inputSchema) to detect drift
                    const toolSchemas = (result.tools ?? []).map((t) => ({
                        name: t.name,
                        description: t.description,
                        inputSchema: t.inputSchema,
                    }));
                    const schemaJson = JSON.stringify(toolSchemas);
                    const currentHash = hashSchema(schemaJson);
                    const capturedAt = Date.now();
                    const lastSchema = getLastSchema(db, serverName);
                    if (!lastSchema || lastSchema.schema_hash !== currentHash) {
                        recordServerSchema(db, {
                            server_name: serverName,
                            schema_hash: currentHash,
                            schema_json: schemaJson,
                            captured_at: capturedAt,
                        });
                    }
                    return {
                        name: serverName,
                        has_changed: lastSchema !== null && lastSchema.schema_hash !== currentHash,
                        previous_hash: lastSchema?.schema_hash ?? null,
                        current_hash: currentHash,
                        changed_at: lastSchema && lastSchema.schema_hash !== currentHash ? capturedAt : null,
                    };
                }
                catch (err) {
                    return {
                        name: serverName,
                        has_changed: false,
                        previous_hash: null,
                        current_hash: null,
                        changed_at: null,
                        error: String(err),
                    };
                }
            }));
            const serverUpdates = results.map((r, i) => {
                if (r.status === "fulfilled")
                    return r.value;
                return {
                    name: filteredServers[i][0],
                    has_changed: false,
                    previous_hash: null,
                    current_hash: null,
                    changed_at: null,
                    error: String(r.reason),
                };
            });
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({ servers: serverUpdates }, null, 2),
                    },
                ],
            };
        }
        // ------------------------------------------------------------------
        // export_dashboard
        // ------------------------------------------------------------------
        if (name === "export_dashboard") {
            const typedArgs = args;
            const outputPath = typedArgs?.output_path;
            const knownServers = getAllServers();
            const serverNames = Object.keys(knownServers).filter((n) => !isSelf(knownServers[n]));
            const statuses = getAllServerStatuses(db, serverNames);
            const enriched = statuses.map((s) => {
                const percentiles = getLatencyPercentiles(db, s.name, 24);
                const history = getServerHistory(db, s.name, 24);
                return {
                    name: s.name,
                    status: s.status,
                    latency_ms: s.latency_ms,
                    p50: percentiles.p50,
                    p95: percentiles.p95,
                    last_seen: s.last_seen,
                    history: history.map((h) => ({
                        latency_ms: h.latency_ms,
                        status: h.status,
                    })),
                };
            });
            const html = generateDashboardHtml(enriched, new Date());
            if (outputPath) {
                const expandedPath = outputPath.startsWith("~/")
                    ? outputPath.replace("~", process.env["HOME"] ?? "~")
                    : outputPath;
                fs.writeFileSync(expandedPath, html, "utf-8");
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify({
                                success: true,
                                output_path: expandedPath,
                                bytes: html.length,
                            }, null, 2),
                        },
                    ],
                };
            }
            return {
                content: [
                    {
                        type: "text",
                        text: html,
                    },
                ],
            };
        }
        // ------------------------------------------------------------------
        // get_history
        // ------------------------------------------------------------------
        if (name === "get_history") {
            const typedArgs = args;
            const serverName = typedArgs?.server_name;
            if (!serverName || typeof serverName !== "string") {
                throw new McpError(ErrorCode.InvalidParams, "server_name is required and must be a string");
            }
            const limit = Math.min(typeof typedArgs?.limit === "number" ? typedArgs.limit : 50, 500);
            const history = getServerHistory(db, serverName, limit);
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({ server_name: serverName, limit, records: history }, null, 2),
                    },
                ],
            };
        }
        // ------------------------------------------------------------------
        // configure_server
        // ------------------------------------------------------------------
        if (name === "configure_server") {
            if (!manualServersPath) {
                throw new McpError(ErrorCode.InternalError, "Manual server registry is not configured. Restart the server with a database path to enable this feature.");
            }
            const typedArgs = args;
            if (!typedArgs?.name || !typedArgs?.command) {
                throw new McpError(ErrorCode.InvalidParams, "name and command are required");
            }
            const manual = loadManualServers(manualServersPath);
            const isUpdate = typedArgs.name in manual;
            manual[typedArgs.name] = {
                command: typedArgs.command,
                args: typedArgs.args ?? [],
                ...(typedArgs.env ? { env: typedArgs.env } : {}),
            };
            saveManualServers(manualServersPath, manual);
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({
                            success: true,
                            action: isUpdate ? "updated" : "added",
                            name: typedArgs.name,
                            command: typedArgs.command,
                            args: typedArgs.args ?? [],
                            message: `Server "${typedArgs.name}" ${isUpdate ? "updated" : "added"}. Run health_check_all to probe it.`,
                        }, null, 2),
                    },
                ],
            };
        }
        // ------------------------------------------------------------------
        // remove_server
        // ------------------------------------------------------------------
        if (name === "remove_server") {
            if (!manualServersPath) {
                throw new McpError(ErrorCode.InternalError, "Manual server registry is not configured. Restart the server with a database path to enable this feature.");
            }
            const typedArgs = args;
            if (!typedArgs?.name) {
                throw new McpError(ErrorCode.InvalidParams, "name is required");
            }
            const manual = loadManualServers(manualServersPath);
            if (!(typedArgs.name in manual)) {
                const discovered = discoverServers(configPath);
                if (typedArgs.name in discovered) {
                    throw new McpError(ErrorCode.InvalidParams, `"${typedArgs.name}" is a discovered server (from Claude's config) and cannot be removed via this tool.`);
                }
                throw new McpError(ErrorCode.InvalidParams, `Server "${typedArgs.name}" was not found in the manual registry.`);
            }
            delete manual[typedArgs.name];
            saveManualServers(manualServersPath, manual);
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({
                            success: true,
                            name: typedArgs.name,
                            message: `Server "${typedArgs.name}" removed from monitoring.`,
                        }, null, 2),
                    },
                ],
            };
        }
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    });
    return server;
}
export async function startServer(options) {
    const server = createHealthMonitorServer(options);
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("[mcp-server-health-monitor] Server started on stdio transport");
}
