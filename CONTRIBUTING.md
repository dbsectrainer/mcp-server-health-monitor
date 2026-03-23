# Contributing to MCP Server Health Monitor

Thank you for your interest in contributing to `mcp-server-health-monitor`!

## Getting Started

```bash
git clone https://github.com/<org>/mcp-server-health-monitor.git
cd mcp-server-health-monitor
npm install
npm test
```

All tests must pass before submitting a pull request.

## Project Layout

```
src/
  probes/            # MCP probe implementation (list_tools handshake, latency measurement)
  server.ts          # MCP Server: all tool handlers and resource handlers
  index.ts           # CLI entry point (yargs flags, daemon mode, transport selection)
  db.ts              # SQLite schema, health check storage, latency percentile queries
  config-discovery.ts  # MCP config auto-detection for macOS, Windows, Linux
  health-config.ts   # Per-server threshold YAML loader (~/.mcp/health-config.yaml)
  http-server.ts     # Streamable HTTP transport (--http-port)
  types.ts           # Shared TypeScript types (McpServerEntry, ServerHealthStatus, etc.)
```

Tool handlers live directly in `server.ts`. Each tool (`health_check_all`, `get_server_status`, `list_degraded`, `get_history`, `configure_server`, `remove_server`, `check_updates`, `export_dashboard`) is implemented as a named branch in the `CallToolRequestSchema` handler.

The manual server registry (`~/.mcp/extra-servers.json`) is read and written by the `loadManualServers` / `saveManualServers` helpers in `server.ts`. The path is derived from the database directory at startup in `index.ts`.

## How to Contribute

### Bug Reports

Open a GitHub issue with:

- Steps to reproduce.
- Expected vs. actual behavior.
- Number and type of monitored servers.
- Node.js version and OS.

### Feature Requests

Open an issue describing the monitoring use case before writing code.

### Pull Requests

1. Fork the repository and create a branch from `main`.
2. Write or update tests for any changed behavior.
3. Run `npm test` and ensure all tests pass.
4. Follow the existing code style (run `npm run lint`).
5. Reference the relevant issue in the PR description.

## Commit Messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(metrics): track consecutive failure count per server
fix(poller): avoid duplicate pings when interval fires late
docs: add alert threshold configuration example to README
```

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). Please read it before contributing.
