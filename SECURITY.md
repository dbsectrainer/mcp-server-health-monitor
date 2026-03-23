# Security Policy

## Supported Versions

| Version | Supported |
| ------- | --------- |
| latest  | Yes       |

We support the latest published version of `mcp-server-health-monitor` on npm. Update to the latest release before reporting a vulnerability.

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Please report security issues by emailing the maintainers directly or using GitHub's private vulnerability reporting feature (Security → Report a vulnerability).

Include as much of the following as possible:

- A description of the vulnerability and its potential impact.
- Steps to reproduce the issue.
- Any proof-of-concept code, if applicable.
- The version of `mcp-server-health-monitor` you are using.

You can expect an initial response within **72 hours** and a resolution or status update within **14 days**.

## Security Considerations

`mcp-server-health-monitor` pings all servers in your MCP configuration:

- Health check requests go only to server addresses already present in your existing MCP config; no external connections are initiated beyond those.
- Restrict file-system permissions on the metrics database to prevent unauthorized read access to server topology and availability data.
- Server response times and version information could be useful to an attacker mapping your environment; treat health reports accordingly.
