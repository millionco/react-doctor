import * as path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { resolveExcludedProjectDirectories } from "../src/cli/utils/resolve-excluded-project-directories.js";

const rootDirectory = path.resolve("/repo");
const webDirectory = path.join(rootDirectory, "apps", "web");
const nativeDirectory = path.join(rootDirectory, "apps", "native");

describe("resolveExcludedProjectDirectories", () => {
  it("excludes every project nested inside the scan directory", () => {
    expect(
      resolveExcludedProjectDirectories(rootDirectory, [
        rootDirectory,
        webDirectory,
        nativeDirectory,
      ]),
    ).toEqual([webDirectory, nativeDirectory]);
  });

  it("never excludes the scan directory itself or its ancestors", () => {
    expect(
      resolveExcludedProjectDirectories(nativeDirectory, [
        rootDirectory,
        webDirectory,
        nativeDirectory,
      ]),
    ).toEqual([]);
  });

  it("deduplicates directories by resolved path, keeping the first spelling", () => {
    expect(
      resolveExcludedProjectDirectories(rootDirectory, [
        webDirectory,
        path.join(rootDirectory, "apps", ".", "web"),
        nativeDirectory,
      ]),
    ).toEqual([webDirectory, nativeDirectory]);
  });
});
