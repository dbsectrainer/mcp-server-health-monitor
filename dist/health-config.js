import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import yaml from "js-yaml";
const DEFAULT_CONFIG = {
    defaults: {
        latency_threshold_ms: 3000,
        timeout_ms: 5000,
    },
    servers: {},
};
function expandTilde(filePath) {
    if (filePath.startsWith("~/") || filePath === "~") {
        return path.join(os.homedir(), filePath.slice(2));
    }
    return filePath;
}
export function loadHealthConfig(customPath) {
    const configPath = customPath
        ? expandTilde(customPath)
        : path.join(os.homedir(), ".mcp", "health-config.yaml");
    if (!fs.existsSync(configPath)) {
        return DEFAULT_CONFIG;
    }
    try {
        const raw = fs.readFileSync(configPath, "utf-8");
        const parsed = yaml.load(raw);
        return {
            defaults: {
                ...DEFAULT_CONFIG.defaults,
                ...(parsed?.defaults ?? {}),
            },
            servers: parsed?.servers ?? {},
        };
    }
    catch {
        // Return defaults if config is unreadable/invalid
        return DEFAULT_CONFIG;
    }
}
export function getServerThresholds(config, serverName, globalLatencyThreshold) {
    const serverOverride = config.servers[serverName] ?? {};
    const defaults = config.defaults;
    return {
        latency_threshold_ms: serverOverride.latency_threshold_ms ??
            defaults.latency_threshold_ms ??
            globalLatencyThreshold,
        timeout_ms: serverOverride.timeout_ms ?? defaults.timeout_ms ?? 5000,
    };
}
