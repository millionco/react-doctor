import * as path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { resolveExcludedProjectDirectories } from "../src/cli/utils/resolve-excluded-project-directories.js";

const rootDirectory = path.resolve("/repo");
const webDirectory = path.join(rootDirectory, "apps", "web");
const nativeDirectory = path.join(rootDirectory, "apps", "native");

describe("resolveExcludedProjectDirectories", () => {
  it("excludes discovered nested projects even when only the root is selected", () => {
    expect(
      resolveExcludedProjectDirectories({
        scanDirectory: rootDirectory,
        selectedProjectDirectories: [rootDirectory],
        workspaceProjectDirectories: [rootDirectory, webDirectory, nativeDirectory],
      }),
    ).toEqual([webDirectory, nativeDirectory]);
  });

  it("never excludes the scan directory itself or its ancestors", () => {
    expect(
      resolveExcludedProjectDirectories({
        scanDirectory: nativeDirectory,
        selectedProjectDirectories: [rootDirectory, nativeDirectory],
        workspaceProjectDirectories: [rootDirectory, webDirectory, nativeDirectory],
      }),
    ).toEqual([]);
  });

  it("merges selected and discovered projects by resolved path", () => {
    expect(
      resolveExcludedProjectDirectories({
        scanDirectory: rootDirectory,
        selectedProjectDirectories: [rootDirectory, webDirectory],
        workspaceProjectDirectories: [
          path.join(rootDirectory, "apps", ".", "web"),
          nativeDirectory,
        ],
      }),
    ).toEqual([webDirectory, nativeDirectory]);
  });

  it("keeps selected directories that workspace discovery did not list", () => {
    const extraDirectory = path.join(rootDirectory, "tools", "storybook");
    expect(
      resolveExcludedProjectDirectories({
        scanDirectory: rootDirectory,
        selectedProjectDirectories: [rootDirectory, extraDirectory],
        workspaceProjectDirectories: [],
      }),
    ).toEqual([extraDirectory]);
  });
});
