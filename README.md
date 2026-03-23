# MCP Server Health Monitor

npm `mcp-server-health-monitor` package

MCP-native health monitoring that speaks the protocol, not just HTTP. Instead of pinging a port, it calls `list_tools` on each server — the same handshake your agent uses — so a green status means the server is actually ready to serve MCP requests. All health history stays local in SQLite; no external monitoring service required.

[Tool reference](#tools) | [Configuration](#configuration) | [Contributing](#contributing) | [Troubleshooting](#troubleshooting)

## Key features

- **Auto-discovery**: Reads your existing MCP config files (Claude Desktop, Cursor, VS Code) with no extra setup.
- **Non-intrusive probing**: Only calls `list_tools` on target servers — read-only, no side effects.
- **Version drift detection**: Compares tool schemas across checks to detect when a server has been updated.
- **Historical trends**: Stores latency history in SQLite; p50/p95 are computed on-demand from stored history to surface regressions before they become outages.
- **HTML dashboard**: Generates a self-contained health dashboard with uptime sparklines per server.
- **Background polling**: Runs as a daemon so health data is always fresh when you ask for it.

## Why this over generic uptime monitors?

Generic uptime monitors (UptimeRobot, Pingdom, BetterStack) check whether a port is open or an HTTP endpoint returns 200. That's not enough for MCP servers — a server can be running but failing to negotiate the MCP protocol or returning a broken tool schema.

|                        | mcp-server-health-monitor                                   | Generic uptime monitors                    |
| ---------------------- | ----------------------------------------------------------- | ------------------------------------------ |
| Probe method           | MCP `list_tools` call — tests actual protocol               | HTTP ping or TCP port check                |
| Schema drift detection | Detects when tool signatures change between versions        | Not possible without protocol awareness    |
| Config auto-discovery  | Reads Claude Desktop, Cursor, VS Code configs automatically | Manual URL entry per server                |
| Data residency         | Local SQLite; no external service                           | Health data stored in vendor cloud         |
| Cost                   | Free, self-hosted                                           | Free tier limited; paid for history/alerts |

If you want to know that your MCP servers are genuinely healthy — not just "the process is running" — this is the right tool.

## Requirements

- Node.js v20.19 or newer.
- npm.

## Getting started

Add the following config to your MCP client:

```json
{
  "mcpServers": {
    "health-monitor": {
      "command": "npx",
      "args": ["-y", "mcp-server-health-monitor@latest"]
    }
  }
}
```

> The monitor auto-discovers other MCP servers from the same config file it is registered in. No additional setup required.

### MCP Client configuration

Amp · Claude Code · Cline · Cursor · VS Code · Windsurf · Zed

## Your first prompt

Enter the following in your MCP client to verify everything is working:

```
Check the health of all my MCP servers.
```

Your client should return a status table showing each server with its current latency and health state.

## Tools

### Health checks (3 tools)

- `health_check_all` — probes all configured servers in parallel via `list_tools`, measures latency, and stores results. Accepts an optional `timeout_ms` parameter (default: 5000).
- `get_server_status` — returns per-server detail including latency, last seen time, 24-hour error count, last error message, and p50/p95 latency percentiles. Requires `server_name`.
- `list_degraded` — filters to servers that are offline or have latency above the threshold. Accepts an optional `latency_threshold` override.

### History (1 tool)

- `get_history` — returns raw health check history for a specific server, ordered most-recent first. Requires `server_name`; accepts optional `limit` (default: 50, max: 500).

### Server registry (2 tools)

- `configure_server` — registers a new MCP server to monitor. Servers added this way are stored in `~/.mcp/extra-servers.json` and merged with auto-discovered servers. Required: `name`, `command`. Optional: `args`, `env`.
- `remove_server` — removes a manually registered server from monitoring. Only affects servers added via `configure_server`; auto-discovered servers are not affected. Requires `name`.

### Updates (1 tool)

- `check_updates` — detects version drift by hashing tool schemas on each probe and comparing against the last stored hash. Returns `has_changed`, `previous_hash`, `current_hash`, and `changed_at` per server.

### Export (1 tool)

- `export_dashboard` — generates a self-contained single-file HTML dashboard with summary cards, per-server status table with p50/p95 latency, and inline SVG uptime sparklines. Accepts an optional `output_path` to write to disk.

## Manual server registry

In addition to auto-discovery from MCP config files, you can register servers that are not in your Claude Desktop config using the `configure_server` tool. Manually registered servers are written to `~/.mcp/extra-servers.json` (stored alongside the health database) and merged with auto-discovered servers on every probe.

```
Add a server named "my-internal-tool" running with command "node" and args ["/opt/tools/server.js"]
```

To stop monitoring a manually registered server:

```
Remove the server named "my-internal-tool" from monitoring
```

Servers discovered from Claude Desktop's config cannot be removed via `remove_server` — edit your MCP config file directly to remove those.

## Configuration

### `--interval` / `--interval-seconds`

How often to poll each MCP server, in seconds.

Type: `number`
Default: `60`

### `--latency-threshold`

Latency in milliseconds above which a server is marked as degraded.

Type: `number`
Default: `1000`

### `--db` / `--db-path`

Path to the SQLite database file used to store health history.

Type: `string`
Default: `~/.mcp/health.db`

### `--daemon`

Run as a background polling daemon. Health data is collected continuously rather than on-demand.

Type: `boolean`
Default: `false`

### `--startup-grace-seconds`

Grace period in seconds before a newly started server is considered unhealthy.

Type: `number`
Default: `10`

Pass flags via the `args` property in your JSON config:

```json
{
  "mcpServers": {
    "health-monitor": {
      "command": "npx",
      "args": ["-y", "mcp-server-health-monitor@latest", "--interval=30", "--latency-threshold=500"]
    }
  }
}
```

## Listings

- Listed on the [MCP Registry](https://registry.mcp.so) — search for `mcp-server-health-monitor`.
- Listed on [MCP Market](https://mcpmarket.com) — search for `mcp-server-health-monitor`.

## Verification

Before publishing a new version, verify the server with MCP Inspector to confirm all tools are exposed correctly and the protocol handshake succeeds.

**Interactive UI** (opens browser):

```bash
npm run build && npm run inspect
```

**CLI mode** (scripted / CI-friendly):

```bash
# List all tools
npx @modelcontextprotocol/inspector --cli node dist/index.js --method tools/list

# List resources and prompts
npx @modelcontextprotocol/inspector --cli node dist/index.js --method resources/list
npx @modelcontextprotocol/inspector --cli node dist/index.js --method prompts/list

# Call a tool (example — replace with a relevant read-only tool for this plugin)
npx @modelcontextprotocol/inspector --cli node dist/index.js \
  --method tools/call --tool-name health_check_all

# Call a tool with arguments
npx @modelcontextprotocol/inspector --cli node dist/index.js \
  --method tools/call --tool-name health_check_all --tool-arg key=value
```

Run before publishing to catch regressions in tool registration and runtime startup.

## Contributing

Probe modules live in `src/probes/`. Each probe must return a `ProbeResult` with `status`, `latencyMs`, and an optional `message`. Keep all probes read-only — never trigger side effects on monitored servers.

```bash
npm install && npm test
```
