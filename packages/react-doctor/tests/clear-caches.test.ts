import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import {
  clearMinifiedFileCache,
  isLargeMinifiedFile,
  MINIFIED_MAX_LINE_LENGTH_CHARS,
  MINIFIED_MIN_SIZE_BYTES,
} from "@react-doctor/core";
import { clearCaches } from "../src/index.js";

const minifiedBundleContents = (): string =>
  `var bundle=${JSON.stringify("a".repeat(MINIFIED_MIN_SIZE_BYTES + MINIFIED_MAX_LINE_LENGTH_CHARS))};`;

describe("clearCaches", () => {
  let temporaryDirectory: string;

  beforeEach(() => {
    clearMinifiedFileCache();
    temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "clear-caches-"));
  });

  afterEach(() => {
    clearMinifiedFileCache();
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  it("clears the memoized minified-file results", () => {
    const bundlePath = path.join(temporaryDirectory, "bundle.js");
    fs.writeFileSync(bundlePath, minifiedBundleContents());
    expect(isLargeMinifiedFile(bundlePath)).toBe(true);

    // Shrink on disk: the cached `true` survives until something clears it.
    fs.writeFileSync(bundlePath, "export const x = 1;\n");
    expect(isLargeMinifiedFile(bundlePath)).toBe(true);

    clearCaches();
    // The aggregate clear must invalidate the minified memo so the predicate
    // re-sniffs the now-small file. A surviving `true` means it was not wired.
    expect(isLargeMinifiedFile(bundlePath)).toBe(false);
  });
});
