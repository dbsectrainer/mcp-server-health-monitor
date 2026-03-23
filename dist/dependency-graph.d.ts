export interface DependencyGraph {
  nodes: string[];
  edges: Array<{
    from: string;
    to: string;
  }>;
}
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
export declare function loadDependencyGraph(filePath?: string): DependencyGraph;
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
export declare function renderDependencyDot(
  graph: DependencyGraph,
  healthStatus: Record<string, string>,
): string;
