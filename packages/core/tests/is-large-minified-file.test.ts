import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { MINIFIED_MAX_LINE_LENGTH_CHARS, MINIFIED_MIN_SIZE_BYTES } from "../src/constants.js";
import { countSourceFiles } from "../src/project-info/count-source-files.js";
import {
  clearMinifiedFileCache,
  isLargeMinifiedFile,
} from "../src/utils/is-large-minified-file.js";
import { listSourceFiles } from "../src/utils/list-source-files.js";

// A single enormous line that clears both gates: total bytes past
// MINIFIED_MIN_SIZE_BYTES and one line far longer than the sniff threshold.
const minifiedBundleContents = (): string =>
  `var bundle=${JSON.stringify("a".repeat(MINIFIED_MIN_SIZE_BYTES + MINIFIED_MAX_LINE_LENGTH_CHARS))};`;

// Large enough to clear the size gate but plainly not minified — many short
// lines keep the average line length far below the sniff threshold.
const largeRealSourceContents = (): string =>
  Array.from({ length: 2_000 }, (_, index) => `const value${index} = ${index};`).join("\n");

// Plainly-not-minified content that is also under the size gate, so an
// un-memoized re-sniff would short-circuit to false on the size check alone.
const tinySourceContents = "export const x = 1;\n";

describe("isLargeMinifiedFile", () => {
  let temporaryDirectory: string;

  beforeEach(() => {
    clearMinifiedFileCache();
    temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "large-minified-"));
  });

  afterEach(() => {
    clearMinifiedFileCache();
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  const writeFile = (name: string, contents: string): string => {
    const filePath = path.join(temporaryDirectory, name);
    fs.writeFileSync(filePath, contents);
    return filePath;
  };

  it("flags a large single-line bundle and clears a large real source file", () => {
    expect(isLargeMinifiedFile(writeFile("bundle.js", minifiedBundleContents()))).toBe(true);
    expect(isLargeMinifiedFile(writeFile("App.tsx", largeRealSourceContents()))).toBe(false);
  });

  it("memoizes the result so a later walk never re-sniffs the same path", () => {
    const bundlePath = writeFile("bundle.js", minifiedBundleContents());
    expect(isLargeMinifiedFile(bundlePath)).toBe(true);

    // Shrink on disk: an un-memoized call would now fail the size gate and
    // return false. The cached `true` proves the second call never re-statted.
    fs.writeFileSync(bundlePath, tinySourceContents);
    expect(isLargeMinifiedFile(bundlePath)).toBe(true);
  });

  it("caches the sub-threshold false so small files are not re-statted", () => {
    const smallPath = writeFile("small.tsx", tinySourceContents);
    expect(isLargeMinifiedFile(smallPath)).toBe(false);

    // Grow past the size gate with minified content: a re-stat would now
    // return true. The cached `false` proves the small result was memoized.
    fs.writeFileSync(smallPath, minifiedBundleContents());
    expect(isLargeMinifiedFile(smallPath)).toBe(false);
  });

  it("re-sniffs after clearMinifiedFileCache invalidates the memo", () => {
    const filePath = writeFile("widget.js", tinySourceContents);
    expect(isLargeMinifiedFile(filePath)).toBe(false);

    fs.writeFileSync(filePath, minifiedBundleContents());
    expect(isLargeMinifiedFile(filePath)).toBe(false);

    clearMinifiedFileCache();
    expect(isLargeMinifiedFile(filePath)).toBe(true);
  });

  it("shares one result across the discovery and lint walks", () => {
    writeFile("bundle.js", minifiedBundleContents());
    writeFile("App.tsx", tinySourceContents);
    fs.mkdirSync(path.join(temporaryDirectory, "dist"));
    writeFile(path.join("dist", "vendor.js"), minifiedBundleContents());

    // Walk #1 (discovery) caches bundle.js -> true, App.tsx -> false; the
    // ignored dist/ tree is skipped, so only App.tsx counts.
    expect(countSourceFiles(temporaryDirectory)).toBe(1);

    // Shrink the bundle on disk. Walk #2 (lint) must still drop it from the
    // scanned set off the shared memo rather than re-sniff the now-small file.
    fs.writeFileSync(path.join(temporaryDirectory, "bundle.js"), tinySourceContents);

    const sourceFiles = listSourceFiles(temporaryDirectory);
    expect(sourceFiles).toContain("App.tsx");
    expect(sourceFiles).not.toContain("bundle.js");
  });
});
