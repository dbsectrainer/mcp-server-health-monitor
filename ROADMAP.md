# Roadmap — MCP Server Health Monitor

## Phase 1: MVP (Weeks 1–3) ✅ Complete

### Goal

Deliver a working health monitor that scans all servers in your MCP config and shows their current status — good enough to replace manually noticing that a server stopped working.

### MCP Protocol Compliance

- [x] Implement stdio transport (required baseline for all MCP servers)
- [x] Strict JSON Schema for all tool inputs — `get_server_status` requires `server_name: string`
- [x] Tool annotations: all tools marked `readOnlyHint: true` (the monitor never modifies monitored servers)
- [x] Proper MCP error codes: `invalid_params` for unknown server names, `internal_error` for probe failures
- [x] Verified with MCP Inspector before publish
- [x] `package.json` with correct `bin`, `files`, `keywords: ["mcp", "mcp-server", "monitoring", "health-check"]`

### Features

- [x] Auto-discover MCP config files (Claude Desktop, Cursor, VS Code) on macOS, Windows, Linux
- [x] `health_check_all` — ping each server via `list_tools`, measure latency (parallel, with `--latency-threshold`)
- [x] `get_server_status` — per-server detail (latency, last seen, error count)
- [x] `list_degraded` — filter to unhealthy/offline servers
- [x] SQLite storage for health history (respects `--db` flag)
- [x] Console text summary output
- [x] `--interval`, `--latency-threshold`, `--startup-grace-seconds` flags wired up
- [x] TypeScript strict mode
- [x] Basic Jest/Vitest test suite
- [x] `CHANGELOG.md` initialized
- [x] Semantic versioning from first release
- [x] Publish to npm

---

## Phase 2: Polish & Adoption (Weeks 4–6) ✅ Complete

### Goal

Make the monitor reliable enough that developers leave it running permanently and trust its output.

### MCP Best Practices

- [x] Progress notifications (`notifications/progress`) for `health_check_all` when scanning many servers
- [x] Cancellation support (`notifications/cancelled`) — abort a health check sweep mid-run
- [x] MCP logging (`notifications/message`) — emit info-level events when a server transitions state (healthy → degraded)
- [x] Streamable HTTP transport (MCP 2025 spec) — deploy the monitor as a shared team service
- [x] MCP Resources primitive: expose each server's health history as a browsable resource (`health://{server_name}`)
- [x] Tool description strings include parameter examples for better LLM tool selection

### Features

- [x] `check_updates` — detect version drift by comparing tool schemas across checks
- [x] `export_dashboard` — single-file HTML health dashboard with uptime sparklines
- [x] `get_history` — raw health check history for a specific server, ordered most-recent first (limit up to 500)
- [x] `configure_server` — register servers not in Claude Desktop's config via a supplementary `~/.mcp/extra-servers.json` manual registry
- [x] `remove_server` — remove manually registered servers from monitoring
- [x] Manual server registry (`~/.mcp/extra-servers.json`) — persists servers added via `configure_server`; merged with auto-discovered servers on every probe
- [x] `--daemon` background polling mode wired up (persistent process, not on-demand)
- [x] Historical latency trends (p50/p95) stored in SQLite
- [x] Configurable per-server thresholds via `~/.mcp/health-config.yaml`
- [x] `health_check_all` fast path — parallel probes with per-server timeout
- [x] Graceful startup grace period (`--startup-grace-seconds`) to avoid false alarms on slow-starting servers
- [x] ESLint + Prettier enforced in CI
- [x] 90%+ test coverage with mocked MCP server fixtures
- [x] GitHub Actions CI (lint, test, build)
- [x] Listed on MCP Registry
- [x] Listed on MCP Market

---

## Phase 3: Alerting & Enterprise (Weeks 7+) 🔲 Planned

### Goal

Serve teams managing shared or distributed MCP environments who need alerting, aggregated visibility, and SLA accountability.

### MCP Enterprise Standards

- [ ] OAuth 2.0 authorization (MCP 2025 spec) for the hosted monitoring API
- [ ] Rate limiting on health check ingestion endpoints
- [ ] API key authentication for team dashboard access
- [x] Multi-transport: stdio for local use, Streamable HTTP for hosted tier

### Features

- [ ] Slack / PagerDuty / webhook alerts on server going offline or transitioning to degraded
- [ ] Team dashboard — aggregate health across multiple developers' environments
- [ ] Uptime tracking and SLA reporting (99.9% uptime calculation per server)
- [ ] Server dependency graph — visualize which workflows depend on which servers
- [ ] Auto-restart policy — attempt to restart a degraded server (configurable, opt-in)

---

## Guiding Principles

- **Read-only probes** — the monitor never triggers side effects on any server it watches
- **Low footprint** — background polling uses minimal CPU and memory at all times
- **Config-file-first** — zero extra setup; reads the MCP config you already have
- **Actionable output** — every alert tells you what failed and what to check first
- **MCP-native** — uses MCP Resources to make health data directly browsable
