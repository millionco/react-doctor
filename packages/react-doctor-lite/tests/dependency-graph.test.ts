import { describe, expect, it } from "vite-plus/test";
import { buildDependencyGraphFromManifest } from "../src/dependency-graph/build-dependency-graph.js";
import { createDependencyGraph } from "../src/dependency-graph/create-dependency-graph.js";
import { mergeDependencySections } from "../src/utils/merge-dependency-sections.js";
import type { PackageNode } from "../src/types.js";

const node = (name: string, dependencies: Record<string, string>): PackageNode => ({
  name,
  directory: "",
  isRoot: false,
  dependencies: new Map(Object.entries(dependencies)),
});

describe("dependency graph queries", () => {
  it("answers presence and range queries in both call shapes", () => {
    const graph = buildDependencyGraphFromManifest({
      dependencies: { react: "^19.2.0", "@tanstack/react-query": "^5.59.0" },
      devDependencies: { typescript: "^5.6.0" },
    });

    expect(graph.hasDependency("react")).toBe(true);
    expect(graph.hasDependency("react@>=19")).toBe(true);
    expect(graph.hasDependency("react", ">=19")).toBe(true);
    expect(graph.hasDependency("react", ">=20")).toBe(false);
    expect(graph.hasDependency("react", "^19")).toBe(true);
    expect(graph.hasDependency("@tanstack/react-query@^5")).toBe(true);
    expect(graph.hasDependency("svelte")).toBe(false);
    expect(graph.getMajor("react")).toBe(19);
    expect(graph.getVersion("react")).toBe("^19.2.0");
  });

  it("derives framework from dependency names", () => {
    expect(
      buildDependencyGraphFromManifest({ dependencies: { next: "15.0.0", react: "19.0.0" } })
        .framework,
    ).toBe("nextjs");
    expect(buildDependencyGraphFromManifest({ dependencies: { preact: "10.0.0" } }).framework).toBe(
      "preact",
    );
    expect(
      buildDependencyGraphFromManifest({ dependencies: { vite: "6.0.0", react: "19.0.0" } })
        .framework,
    ).toBe("vite");
  });

  it("uses the lowest installed major across a monorepo graph", () => {
    const graph = createDependencyGraph([
      node("web", { react: "^19.0.0" }),
      node("legacy", { react: "^18.2.0" }),
    ]);

    expect(graph.getMajor("react")).toBe(18);
    expect(graph.hasDependency("react", ">=19")).toBe(false);
    expect(graph.hasDependency("react", ">=18")).toBe(true);
  });

  it("ignores non-concrete specifiers for version math", () => {
    const graph = createDependencyGraph([node("app", { react: "workspace:*" })]);
    expect(graph.hasDependency("react")).toBe(true);
    expect(graph.getMajor("react")).toBeNull();
    expect(graph.hasDependency("react", ">=19")).toBe(false);
  });

  it("merges sections with dependencies winning over peers/dev", () => {
    const merged = mergeDependencySections({
      peerDependencies: { react: ">=18" },
      dependencies: { react: "19.0.0" },
    });
    expect(merged.get("react")).toBe("19.0.0");
  });
});
