import { describe, it, expect, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { loadDependencyGraph, renderDependencyDot } from "../src/dependency-graph.js";

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

let tmpFiles: string[] = [];

function writeTempYaml(content: string): string {
  const tmpPath = path.join(os.tmpdir(), `test-deps-${Date.now()}-${Math.random()}.yaml`);
  fs.writeFileSync(tmpPath, content, "utf-8");
  tmpFiles.push(tmpPath);
  return tmpPath;
}

afterEach(() => {
  for (const f of tmpFiles) {
    try {
      fs.unlinkSync(f);
    } catch {
      // ignore
    }
  }
  tmpFiles = [];
});

// --------------------------------------------------------------------------
// loadDependencyGraph tests
// --------------------------------------------------------------------------

describe("loadDependencyGraph", () => {
  it("returns empty graph when file does not exist", () => {
    const graph = loadDependencyGraph("/nonexistent/path/server-deps.yaml");
    expect(graph.nodes).toHaveLength(0);
    expect(graph.edges).toHaveLength(0);
  });

  it("returns empty graph for an empty YAML file", () => {
    const tmpPath = writeTempYaml("");
    const graph = loadDependencyGraph(tmpPath);
    expect(graph.nodes).toHaveLength(0);
    expect(graph.edges).toHaveLength(0);
  });

  it("loads nodes and edges from a valid YAML file", () => {
    const yaml = [
      "dependencies:",
      '  - server: "mcp-data-pipeline"',
      '    depends_on: ["mcp-postgres-server", "mcp-s3-connector"]',
    ].join("\n");

    const tmpPath = writeTempYaml(yaml);
    const graph = loadDependencyGraph(tmpPath);

    expect(graph.nodes).toContain("mcp-data-pipeline");
    expect(graph.nodes).toContain("mcp-postgres-server");
    expect(graph.nodes).toContain("mcp-s3-connector");
    expect(graph.nodes).toHaveLength(3);

    expect(graph.edges).toHaveLength(2);
    expect(graph.edges).toContainEqual({ from: "mcp-data-pipeline", to: "mcp-postgres-server" });
    expect(graph.edges).toContainEqual({ from: "mcp-data-pipeline", to: "mcp-s3-connector" });
  });

  it("handles servers with no depends_on", () => {
    const yaml = ["dependencies:", '  - server: "standalone-server"'].join("\n");

    const tmpPath = writeTempYaml(yaml);
    const graph = loadDependencyGraph(tmpPath);

    expect(graph.nodes).toContain("standalone-server");
    expect(graph.edges).toHaveLength(0);
  });

  it("handles multiple server entries", () => {
    const yaml = [
      "dependencies:",
      '  - server: "server-a"',
      '    depends_on: ["server-b"]',
      '  - server: "server-c"',
      '    depends_on: ["server-b", "server-d"]',
    ].join("\n");

    const tmpPath = writeTempYaml(yaml);
    const graph = loadDependencyGraph(tmpPath);

    expect(graph.nodes).toContain("server-a");
    expect(graph.nodes).toContain("server-b");
    expect(graph.nodes).toContain("server-c");
    expect(graph.nodes).toContain("server-d");
    expect(graph.edges).toHaveLength(3);
  });

  it("deduplicates nodes that appear in multiple depends_on lists", () => {
    const yaml = [
      "dependencies:",
      '  - server: "a"',
      '    depends_on: ["shared"]',
      '  - server: "b"',
      '    depends_on: ["shared"]',
    ].join("\n");

    const tmpPath = writeTempYaml(yaml);
    const graph = loadDependencyGraph(tmpPath);

    const sharedCount = graph.nodes.filter((n) => n === "shared").length;
    expect(sharedCount).toBe(1);
  });

  it("returns empty graph for malformed YAML", () => {
    const tmpPath = writeTempYaml("{ invalid: yaml: [[[");
    const graph = loadDependencyGraph(tmpPath);
    expect(graph.nodes).toHaveLength(0);
    expect(graph.edges).toHaveLength(0);
  });
});

// --------------------------------------------------------------------------
// renderDependencyDot tests
// --------------------------------------------------------------------------

describe("renderDependencyDot", () => {
  it("produces valid DOT format output", () => {
    const graph = {
      nodes: ["server-a", "server-b"],
      edges: [{ from: "server-a", to: "server-b" }],
    };

    const dot = renderDependencyDot(graph, {});
    expect(dot).toContain("digraph mcp_dependencies {");
    expect(dot).toContain("}");
    expect(dot).toContain('"server-a"');
    expect(dot).toContain('"server-b"');
    expect(dot).toContain('"server-a" -> "server-b"');
  });

  it("colors healthy nodes green", () => {
    const graph = { nodes: ["healthy-server"], edges: [] };
    const dot = renderDependencyDot(graph, { "healthy-server": "healthy" });
    expect(dot).toContain("fillcolor=green");
  });

  it("colors degraded nodes yellow", () => {
    const graph = { nodes: ["slow-server"], edges: [] };
    const dot = renderDependencyDot(graph, { "slow-server": "degraded" });
    expect(dot).toContain("fillcolor=yellow");
  });

  it("colors offline nodes red", () => {
    const graph = { nodes: ["dead-server"], edges: [] };
    const dot = renderDependencyDot(graph, { "dead-server": "offline" });
    expect(dot).toContain("fillcolor=red");
  });

  it("colors unknown nodes grey", () => {
    const graph = { nodes: ["mystery-server"], edges: [] };
    const dot = renderDependencyDot(graph, {}); // no status provided
    expect(dot).toContain("fillcolor=grey");
  });

  it("includes style=filled on all nodes", () => {
    const graph = { nodes: ["srv"], edges: [] };
    const dot = renderDependencyDot(graph, { srv: "healthy" });
    expect(dot).toContain("style=filled");
  });

  it("returns empty graph structure for empty input", () => {
    const graph = { nodes: [], edges: [] };
    const dot = renderDependencyDot(graph, {});
    expect(dot).toContain("digraph mcp_dependencies {");
    expect(dot.trim().endsWith("}")).toBe(true);
  });

  it("sets rankdir=LR", () => {
    const graph = { nodes: [], edges: [] };
    const dot = renderDependencyDot(graph, {});
    expect(dot).toContain("rankdir=LR");
  });
});
