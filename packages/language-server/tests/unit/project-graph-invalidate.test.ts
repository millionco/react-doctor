import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import {
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
});
