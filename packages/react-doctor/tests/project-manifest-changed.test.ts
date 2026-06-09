import * as path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import type { DiffInfo } from "../src/index.js";
import { projectManifestChanged } from "../src/cli/utils/project-manifest-changed.js";

const buildDiffInfo = (changedFiles: string[]): DiffInfo => ({
  currentBranch: "main",
  baseBranch: "main",
  changedFiles,
  isCurrentChanges: true,
});

describe("projectManifestChanged", () => {
  it("detects a root package.json change when scanning the diff root", () => {
    const rootDirectory = path.join("/repo");
    expect(
      projectManifestChanged(rootDirectory, rootDirectory, buildDiffInfo(["package.json"])),
    ).toBe(true);
  });

  it("is false when only source / other files changed at the root", () => {
    const rootDirectory = path.join("/repo");
    expect(
      projectManifestChanged(
        rootDirectory,
        rootDirectory,
        buildDiffInfo(["src/App.tsx", "README.md"]),
      ),
    ).toBe(false);
  });

  it("matches a child workspace's own package.json", () => {
    const rootDirectory = path.join("/repo");
    const projectDirectory = path.join(rootDirectory, "apps", "web");
    expect(
      projectManifestChanged(
        rootDirectory,
        projectDirectory,
        buildDiffInfo(["apps/web/package.json", "apps/admin/src/App.tsx"]),
      ),
    ).toBe(true);
  });

  it("does not match a sibling workspace's package.json", () => {
    const rootDirectory = path.join("/repo");
    const projectDirectory = path.join(rootDirectory, "apps", "web");
    expect(
      projectManifestChanged(
        rootDirectory,
        projectDirectory,
        buildDiffInfo(["apps/admin/package.json"]),
      ),
    ).toBe(false);
  });

  it("does not match the root manifest when scanning a child workspace", () => {
    const rootDirectory = path.join("/repo");
    const projectDirectory = path.join(rootDirectory, "apps", "web");
    expect(
      projectManifestChanged(rootDirectory, projectDirectory, buildDiffInfo(["package.json"])),
    ).toBe(false);
  });

  it("does not match a nested non-manifest package.json path", () => {
    const rootDirectory = path.join("/repo");
    expect(
      projectManifestChanged(
        rootDirectory,
        rootDirectory,
        buildDiffInfo(["packages/foo/package.json"]),
      ),
    ).toBe(false);
  });
});
