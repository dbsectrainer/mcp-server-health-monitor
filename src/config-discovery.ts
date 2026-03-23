import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { McpConfig, McpServerEntry } from "./types.js";

function getConfigPaths(): string[] {
  const home = os.homedir();
  const platform = process.platform;

  const paths: string[] = [];

  // Claude Desktop
  if (platform === "darwin") {
    paths.push(path.join(home, "Library/Application Support/Claude/claude_desktop_config.json"));
  } else if (platform === "linux") {
    paths.push(path.join(home, ".config/Claude/claude_desktop_config.json"));
  } else if (platform === "win32") {
    const appData = process.env["APPDATA"] ?? path.join(home, "AppData/Roaming");
    paths.push(path.join(appData, "Claude/claude_desktop_config.json"));
  }

  // Cursor
  paths.push(path.join(home, ".cursor/mcp.json"));

  // VS Code
  paths.push(path.join(home, ".vscode/mcp.json"));

  return paths.filter((p) => fs.existsSync(p));
}

export function discoverServers(customConfigPath?: string): Record<string, McpServerEntry> {
  const configPaths = customConfigPath ? [customConfigPath] : getConfigPaths();
  const servers: Record<string, McpServerEntry> = {};

  for (const configPath of configPaths) {
    try {
      const raw = fs.readFileSync(configPath, "utf-8");
      const config = JSON.parse(raw) as McpConfig;
      if (config.mcpServers) {
        for (const [name, entry] of Object.entries(config.mcpServers)) {
          servers[name] = { ...entry, name };
        }
      }
    } catch {
      // Skip unreadable configs
    }
  }

  return servers;
}
