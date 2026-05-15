import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { parseGitattributesLinguistPaths } from "../src/core/parse-gitattributes-linguist.js";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rd-gitattributes-"));

afterAll(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

const writeFixture = (name: string, content: string): string => {
  const filePath = path.join(tempRoot, name);
  fs.writeFileSync(filePath, content);
  return filePath;
};

describe("parseGitattributesLinguistPaths", () => {
  it("extracts paths marked linguist-vendored (no value, default true)", () => {
    const filePath = writeFixture(
      "vendored.gitattributes",
      "vendor/** linguist-vendored\nthird_party/** linguist-vendored=true\n",
    );
    expect(parseGitattributesLinguistPaths(filePath)).toEqual(["vendor/**", "third_party/**"]);
  });

  it("extracts paths marked linguist-generated", () => {
    const filePath = writeFixture(
      "generated.gitattributes",
      "**/*.gen.ts linguist-generated\nproto/** linguist-generated=true\n",
    );
    expect(parseGitattributesLinguistPaths(filePath)).toEqual(["**/*.gen.ts", "proto/**"]);
  });

  it("does NOT extract paths marked linguist-vendored=false (explicit opt-in to linting)", () => {
    const filePath = writeFixture(
      "opt-in.gitattributes",
      "src/foo.tsx linguist-vendored=false\nsrc/bar.tsx linguist-generated=false\n",
    );
    expect(parseGitattributesLinguistPaths(filePath)).toEqual([]);
  });

  it("ignores comments and blank lines", () => {
    const filePath = writeFixture(
      "comments.gitattributes",
      "# Vendored libraries\nvendor/** linguist-vendored\n\n# Build outputs\ndist/** linguist-generated\n",
    );
    expect(parseGitattributesLinguistPaths(filePath)).toEqual(["vendor/**", "dist/**"]);
  });

  it("ignores lines without linguist-* attributes (e.g., text=auto, eol=lf)", () => {
    const filePath = writeFixture(
      "non-linguist.gitattributes",
      "* text=auto\n*.sh text eol=lf\nvendor/** linguist-vendored\n",
    );
    expect(parseGitattributesLinguistPaths(filePath)).toEqual(["vendor/**"]);
  });

  it("returns [] when the file does not exist", () => {
    expect(parseGitattributesLinguistPaths(path.join(tempRoot, "missing.gitattributes"))).toEqual(
      [],
    );
  });

  it("ignores lines with only a path spec and no attributes", () => {
    const filePath = writeFixture("orphan.gitattributes", "vendor/**\n");
    expect(parseGitattributesLinguistPaths(filePath)).toEqual([]);
  });

  it("accepts case-insensitive linguist attributes (=TRUE, =FALSE, etc.)", () => {
    const filePath = writeFixture(
      "case-insensitive.gitattributes",
      "vendor/** linguist-vendored=TRUE\nbuild/** Linguist-Generated=true\nlive/** linguist-vendored=FALSE\n",
    );
    expect(parseGitattributesLinguistPaths(filePath)).toEqual(["vendor/**", "build/**"]);
  });

  it("accepts =1 / =0 numeric truthiness", () => {
    const filePath = writeFixture(
      "numeric.gitattributes",
      "vendor/** linguist-vendored=1\nlive/** linguist-vendored=0\n",
    );
    expect(parseGitattributesLinguistPaths(filePath)).toEqual(["vendor/**"]);
  });
});
