import * as path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import type { DiffInfo } from "../src/index.js";
import { resolveProjectDiffIncludePaths } from "../src/cli/utils/resolve-project-diff-include-paths.js";

const buildDiffInfo = (changedFiles: string[]): DiffInfo => ({
  currentBranch: "main",
  baseBranch: "main",
  changedFiles,
  isCurrentChanges: true,
});

describe("resolveProjectDiffIncludePaths", () => {
  it("returns source files unchanged when scanning the diff root", () => {
    const rootDirectory = path.join("/repo");
    const diffInfo = buildDiffInfo(["src/App.tsx", "README.md"]);

    expect(resolveProjectDiffIncludePaths(rootDirectory, rootDirectory, diffInfo)).toEqual([
      "src/App.tsx",
    ]);
  });

  it("keeps supported module source extensions from changed-file lists", () => {
    const rootDirectory = path.join("/repo");
    const diffInfo = buildDiffInfo(["proxy.mjs", "src/middleware.mts", "README.md"]);

    expect(resolveProjectDiffIncludePaths(rootDirectory, rootDirectory, diffInfo)).toEqual([
      "proxy.mjs",
      "src/middleware.mts",
    ]);
  });

  it("strips the project prefix for changed files inside a child workspace", () => {
    const rootDirectory = path.join("/repo");
    const projectDirectory = path.join(rootDirectory, "apps", "web");
    const diffInfo = buildDiffInfo([
      "apps/web/src/App.tsx",
      "apps/web/package.json",
      "apps/admin/src/App.tsx",
    ]);

    expect(resolveProjectDiffIncludePaths(rootDirectory, projectDirectory, diffInfo)).toEqual([
      "src/App.tsx",
    ]);
  });

  it("returns no files for unchanged sibling workspaces", () => {
    const rootDirectory = path.join("/repo");
    const projectDirectory = path.join(rootDirectory, "apps", "admin");
    const diffInfo = buildDiffInfo(["apps/web/src/App.tsx"]);

    expect(resolveProjectDiffIncludePaths(rootDirectory, projectDirectory, diffInfo)).toEqual([]);
  });

  it("returns no files when only non-source files changed in a child workspace", () => {
    const rootDirectory = path.join("/repo");
    const projectDirectory = path.join(rootDirectory, "apps", "web");
    const diffInfo = buildDiffInfo(["apps/web/package.json", "apps/web/README.md"]);

    expect(resolveProjectDiffIncludePaths(rootDirectory, projectDirectory, diffInfo)).toEqual([]);
  });

  it("keeps nested paths relative to the selected child workspace", () => {
    const rootDirectory = path.join("/repo");
    const projectDirectory = path.join(rootDirectory, "packages", "ui");
    const diffInfo = buildDiffInfo(["packages/ui/src/components/Button.tsx"]);

    expect(resolveProjectDiffIncludePaths(rootDirectory, projectDirectory, diffInfo)).toEqual([
      "src/components/Button.tsx",
    ]);
  });

  it("does not match sibling names that merely share a prefix", () => {
    const rootDirectory = path.join("/repo");
    const projectDirectory = path.join(rootDirectory, "apps", "web");
    const diffInfo = buildDiffInfo(["apps/web-old/src/App.tsx"]);

    expect(resolveProjectDiffIncludePaths(rootDirectory, projectDirectory, diffInfo)).toEqual([]);
  });
});
