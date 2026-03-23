import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import yaml from "js-yaml";
const DEFAULT_DEPS_PATH = path.join(os.homedir(), ".mcp", "server-deps.yaml");
/**
 * Loads the dependency graph from a YAML file.
 *
 * Expected format:
 * ```yaml
 * dependencies:
 *   - server: "mcp-data-pipeline"
 *     depends_on: ["mcp-postgres-server", "mcp-s3-connector"]
 * ```
 *
 * @param filePath - Optional path to the YAML file (default: ~/.mcp/server-deps.yaml).
 */
export function loadDependencyGraph(filePath) {
    const resolvedPath = filePath ?? DEFAULT_DEPS_PATH;
    if (!fs.existsSync(resolvedPath)) {
        return { nodes: [], edges: [] };
    }
    let config;
    try {
        const content = fs.readFileSync(resolvedPath, "utf-8");
        config = yaml.load(content) ?? {};
    }
    catch {
        return { nodes: [], edges: [] };
    }
    const nodeSet = new Set();
    const edges = [];
    for (const entry of config.dependencies ?? []) {
        if (!entry.server)
            continue;
        nodeSet.add(entry.server);
        for (const dep of entry.depends_on ?? []) {
            nodeSet.add(dep);
            edges.push({ from: entry.server, to: dep });
        }
    }
    return {
        nodes: Array.from(nodeSet),
        edges,
    };
}
/**
 * Renders the dependency graph as a DOT format string.
 * Nodes are colored by health status:
 * - healthy  → green
 * - degraded → yellow
 * - offline  → red
 * - unknown  → grey
 *
 * @param graph        - The dependency graph to render.
 * @param healthStatus - Map of server name → status string.
 */
export function renderDependencyDot(graph, healthStatus) {
    const colorMap = {
        healthy: "green",
        degraded: "yellow",
        offline: "red",
    };
    const nodeLines = graph.nodes.map((n) => {
        const status = healthStatus[n] ?? "unknown";
        const color = colorMap[status] ?? "grey";
        return `  "${n}" [style=filled, fillcolor=${color}];`;
    });
    const edgeLines = graph.edges.map((e) => `  "${e.from}" -> "${e.to}";`);
    return ["digraph mcp_dependencies {", "  rankdir=LR;", ...nodeLines, ...edgeLines, "}"].join("\n");
}
