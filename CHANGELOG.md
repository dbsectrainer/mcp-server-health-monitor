# Changelog

All notable changes to MCP Server Health Monitor will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 1.0.0 (2026-03-23)


### Features

* add mcpName for official MCP registry publication ([4d9600f](https://github.com/dbsectrainer/mcp-server-health-monitor/commit/4d9600f336a66611425f974282a6bafa8b0e9378))
* add server.json for official MCP registry ([03f2ba8](https://github.com/dbsectrainer/mcp-server-health-monitor/commit/03f2ba8eae8365604245228ffeb5430b123a4994))
* initial release v1.0.0 ([41ffc06](https://github.com/dbsectrainer/mcp-server-health-monitor/commit/41ffc0616ef6665f838ac5fe9083acf0b8d397d5))


### Bug Fixes

* **ci:** lower coverage thresholds and add smithery.yaml ([4e3bc0d](https://github.com/dbsectrainer/mcp-server-health-monitor/commit/4e3bc0d0c1d781c1b3b73a435baef2cacbed528a))

## [Unreleased]

## [0.2.1] - 2026-03-23

### Added

- **`get_history` tool**: Returns the raw health check history for a specific MCP server, ordered most-recent first. Accepts `server_name` (required) and `limit` (optional, default 50, max 500). Complements the existing `health://` MCP Resources primitive with a direct tool interface.
- **`configure_server` tool**: Registers a new MCP server to monitor via a supplementary manual registry. Takes `name` and `command` (required), plus optional `args` and `env`. Entries are persisted to `~/.mcp/extra-servers.json` (stored alongside the health database) and merged with servers auto-discovered from Claude Desktop's config on every probe.
- **`remove_server` tool**: Removes a manually registered server from the monitoring registry. Only affects entries in `extra-servers.json`; servers discovered from Claude Desktop's config are not affected. Returns a clear error if the caller attempts to remove an auto-discovered server.
- **Manual server registry (`extra-servers.json`)**: New supplementary config file at `~/.mcp/extra-servers.json` that persists servers added via `configure_server`. The file is created automatically on first `configure_server` call and read on startup alongside auto-discovered config. Merging is additive — manual entries are only applied when a name is not already present from auto-discovery, preventing manual entries from shadowing the authoritative MCP config.

## [1.0.0] - 2026-03-12

### Added

- `.env.example` documenting `MCP_API_KEY` and `MCP_JWT_SECRET`.

### Changed

- `@types/node` upgraded from `^20.x` to `^24.12.0` (Node 24 LTS).
- `yargs` upgraded from `^17.x` to `^18.0.0`.
- Added `author`, `license`, `repository`, and `homepage` fields to `package.json`.

### Security

- Resolved **GHSA-67mh-4wv8-2f99** (`esbuild` ≤ 0.24.2 dev-server cross-origin exposure) by upgrading `vitest` and `@vitest/coverage-v8` to `^4.1.0`. Affects local development only; not a production runtime concern.

## [0.2.0] - 2026-03-12

### Added

- **Historical latency trends (p50/p95)**: `getLatencyPercentiles` function queries the last N hours of health checks and computes p50/p95 percentiles; results surfaced in `get_server_status` responses.
- **`check_updates` tool**: Detects version drift by hashing tool schemas on each probe and comparing against the last stored hash in a new `server_schemas` SQLite table. Returns `has_changed`, `previous_hash`, `current_hash`, and `changed_at` per server.
- **`export_dashboard` tool**: Generates a self-contained single-file HTML dashboard with summary cards (total/healthy/degraded/offline), a per-server status table with p50/p95 latency, and inline SVG uptime sparklines for the last 24 checks. Accepts an optional `output_path` parameter to write to disk.
- **`--daemon` mode**: Background polling process that runs `health_check_all` on a configurable interval (`--interval`, default 60 s), logs state to stderr, and handles `SIGINT`/`SIGTERM` for graceful shutdown.
- **Configurable per-server thresholds** via `~/.mcp/health-config.yaml` (or `--health-config` flag). Supports `defaults.latency_threshold_ms`, `defaults.timeout_ms`, and per-server overrides under `servers.<name>`.
- **MCP Resources primitive**: `health://{server_name}` URIs expose each server's last 50 health checks as browsable JSON resources via `ListResourcesRequestSchema` / `ReadResourceRequestSchema`.
- **Streamable HTTP transport**: New `src/http-server.ts` starts a `StreamableHTTPServerTransport` (MCP 2025 spec); enabled via `--http-port` CLI flag.
- **Progress notifications** (`notifications/progress`): `health_check_all` emits one progress event per server probed (progress / total).
- **MCP logging notifications** (`notifications/message`): `info` events on healthy → degraded/offline and degraded/offline → healthy transitions; `debug` events per server probe during `health_check_all`.
- **Cancellation support** (`notifications/cancelled`): Sets a per-request flag that `health_check_all` checks between server probes to abort early.
- **Tool description examples**: All tool input-schema parameter descriptions now include concrete usage examples for better LLM tool selection.
- **ESLint + Prettier**: `.eslintrc.json` (TypeScript-aware) and `.prettierrc.json` added; `lint` and `format` scripts added to `package.json`.
- **GitHub Actions CI**: `.github/workflows/ci.yml` runs `npm ci`, `npm run build`, `npm test`, and `npm run lint` on push/PR to `main`.
- **Expanded test coverage**: 41 tests across `probe.test.ts` and `server.test.ts`, covering latency percentiles, schema change detection, server history, health-config YAML loading, per-server thresholds, MCP Resources capability, and dashboard prerequisites.
- **New CLI flags**: `--daemon`, `--http-port`, `--health-config`.

## [0.1.0] - 2026-03-12

### Added

- Initial public release of `mcp-server-health-monitor`.
- Auto-discovery of MCP config files for Claude Desktop, Cursor, and VS Code on macOS, Windows, and Linux.
- `health_check_all` tool — probes all configured MCP servers in parallel via `list_tools`, measures latency, and records results to SQLite.
- `get_server_status` tool — returns per-server detail including latency, last seen time, 24-hour error count, and last error message.
- `list_degraded` tool — filters to servers that are offline or have latency exceeding the configured threshold.
- SQLite-backed health history via `better-sqlite3`; database path configurable with `--db` flag (default: `~/.mcp/health.db`).
- CLI flags: `--interval`, `--latency-threshold`, `--db`, `--startup-grace-seconds`, `--config`.
- Startup grace period (`--startup-grace-seconds`): newly discovered servers are not counted as offline during the grace window.
- All tools annotated `readOnlyHint: true` — the monitor never modifies monitored servers.
- Proper MCP error codes: `invalid_params` for unknown server names, `internal_error` for probe failures.
- TypeScript strict mode throughout (`strict: true`).
- Vitest test suite covering database operations, config discovery, probe behaviour, and degraded-server filtering.
- Self-exclusion: the health monitor omits itself from the set of servers it probes to prevent infinite loops.
