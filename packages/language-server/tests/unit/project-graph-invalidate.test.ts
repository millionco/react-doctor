import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import {
  classifyPackageRole,
  clearMinifiedFileCache,
  isLargeMinifiedFile,
  MINIFIED_MAX_LINE_LENGTH_CHARS,
  MINIFIED_MIN_SIZE_BYTES,
} from "@react-doctor/core";
import { createProjectGraph } from "../../src/core/project-graph.js";

const minifiedBundleContents = (): string =>
  `var bundle=${JSON.stringify("a".repeat(MINIFIED_MIN_SIZE_BYTES + MINIFIED_MAX_LINE_LENGTH_CHARS))};`;

describe("createProjectGraph invalidate", () => {
  let workspaceRoot: string;

  beforeEach(() => {
    clearMinifiedFileCache();
    workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rd-project-graph-test-"));
  });

  afterEach(() => {
    clearMinifiedFileCache();
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("clears the minified-file memo so a changed bundle is re-sniffed on the next scan", () => {
    const graph = createProjectGraph({ roots: [workspaceRoot] });
    const bundlePath = path.join(workspaceRoot, "bundle.js");
    fs.writeFileSync(bundlePath, minifiedBundleContents());
    expect(isLargeMinifiedFile(bundlePath)).toBe(true);

    // The editor caches listSourceFiles' minified classification at module
    // scope; without invalidate() clearing it, a shrunk bundle stays excluded
    // from scans for the life of the language-server process.
    fs.writeFileSync(bundlePath, "export const x = 1;\n");
    expect(isLargeMinifiedFile(bundlePath)).toBe(true);

    graph.invalidate();
    expect(isLargeMinifiedFile(bundlePath)).toBe(false);
  });

  it("clears the package-role memo when the project graph is invalidated", () => {
    const graph = createProjectGraph({ roots: [workspaceRoot] });
    const packageDirectory = path.join(workspaceRoot, "package");
    const sourcePath = path.join(packageDirectory, "src", "button.tsx");
    fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
    fs.writeFileSync(sourcePath, "export const button = null;\n");
    fs.writeFileSync(
      path.join(packageDirectory, "package.json"),
      JSON.stringify({ name: "@scope/ui", exports: { ".": "./index.js" } }),
    );
    expect(classifyPackageRole(sourcePath)).toBe("library");

    fs.writeFileSync(
      path.join(packageDirectory, "package.json"),
      JSON.stringify({ name: "@scope/ui", private: true }),
    );
    expect(classifyPackageRole(sourcePath)).toBe("library");

    graph.invalidate();
    expect(classifyPackageRole(sourcePath)).toBe("unknown");
  });
});
