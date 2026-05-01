import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { readIgnoreFile } from "../src/utils/read-ignore-file.js";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rd-read-ignore-"));

afterAll(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

const writeFixture = (name: string, content: string): string => {
  const filePath = path.join(tempRoot, name);
  fs.writeFileSync(filePath, content);
  return filePath;
};

describe("readIgnoreFile", () => {
  it("returns each non-empty, non-comment line as a pattern", () => {
    const filePath = writeFixture("basic.ignore", "node_modules/\ndist/\nbuild/**\n*.log\n");
    expect(readIgnoreFile(filePath)).toEqual(["node_modules/", "dist/", "build/**", "*.log"]);
  });

  it("strips comments and blank lines", () => {
    const filePath = writeFixture(
      "with-comments.ignore",
      "# Build artifacts\ndist/\n\n# Logs\n*.log\n   \n# Trailing\n",
    );
    expect(readIgnoreFile(filePath)).toEqual(["dist/", "*.log"]);
  });

  it("returns [] when the file does not exist", () => {
    expect(readIgnoreFile(path.join(tempRoot, "does-not-exist.ignore"))).toEqual([]);
  });

  it("trims whitespace around patterns", () => {
    const filePath = writeFixture("whitespace.ignore", "  src/skipped.tsx  \n\tdist/  \n");
    expect(readIgnoreFile(filePath)).toEqual(["src/skipped.tsx", "dist/"]);
  });

  it("does not strip negation prefix `!` (caller passes that through to oxlint)", () => {
    const filePath = writeFixture(
      "negation.ignore",
      "node_modules/\n!node_modules/keep-this.tsx\n",
    );
    expect(readIgnoreFile(filePath)).toEqual(["node_modules/", "!node_modules/keep-this.tsx"]);
  });

  it("returns [] for an empty file", () => {
    const filePath = writeFixture("empty.ignore", "");
    expect(readIgnoreFile(filePath)).toEqual([]);
  });

  it("returns [] for a comments-and-blanks-only file", () => {
    const filePath = writeFixture(
      "only-comments.ignore",
      "# just a header\n   \n\n# another note\n",
    );
    expect(readIgnoreFile(filePath)).toEqual([]);
  });

  it("strips `\\#` escape so the pattern is the literal `#config`", () => {
    const filePath = writeFixture("hash-escape.ignore", "\\#config\n");
    expect(readIgnoreFile(filePath)).toEqual(["#config"]);
  });

  it("strips `\\!` escape so the pattern is the literal `!important`", () => {
    const filePath = writeFixture("bang-escape.ignore", "\\!important\n");
    expect(readIgnoreFile(filePath)).toEqual(["!important"]);
  });
});
