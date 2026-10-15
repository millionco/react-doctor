import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { parseGitattributesLinguistPaths } from "@react-doctor/core";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rd-gitattributes-"));
const ATTRIBUTE_STATES = [
  "",
  "=true",
  "=false",
  "=0",
  "=off",
  "=no",
  "=unset",
  "=unspecified",
  "-",
  "!",
];
const SOURCE_PATHS = [
  "app.tsx",
  "src/app.tsx",
  "src/deep/app.tsx",
  "src/.hidden.tsx",
  "other/file.tsx",
];

afterAll(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

describe("parseGitattributesLinguistPaths", () => {
  it("matches Git's per-attribute precedence for ordered overrides", () => {
    expect(spawnSync("git", ["init", "--quiet"], { cwd: tempRoot }).status).toBe(0);
    const filePath = path.join(tempRoot, ".gitattributes");
    for (const generatedState of ATTRIBUTE_STATES) {
      for (const vendoredState of ATTRIBUTE_STATES) {
        const attributes = [
          ["linguist-generated", generatedState],
          ["linguist-vendored", vendoredState],
        ].map(([attribute, state]) =>
          state === "-" || state === "!" ? `${state}${attribute}` : `${attribute}${state}`,
        );
        fs.writeFileSync(
          filePath,
          [
            "*.tsx linguist-generated linguist-vendored",
            `src/** ${attributes.join(" ")}`,
            "src/deep/** !linguist-generated -linguist-vendored",
          ].join("\n"),
        );
        const result = spawnSync(
          "git",
          ["check-attr", "-z", "--stdin", "linguist-generated", "linguist-vendored"],
          {
            cwd: tempRoot,
            encoding: "utf-8",
            input: `${SOURCE_PATHS.join("\0")}\0`,
          },
        );
        expect(result.status).toBe(0);
        const fields = result.stdout.split("\0");
        const ignoredPaths = new Set<string>();
        for (let index = 0; index + 2 < fields.length; index += 3) {
          if (["set", "true"].includes(fields[index + 2])) ignoredPaths.add(fields[index]);
        }
        expect(parseGitattributesLinguistPaths(filePath, SOURCE_PATHS)).toEqual(
          SOURCE_PATHS.filter((sourcePath) => ignoredPaths.has(sourcePath)),
        );
      }
    }
  });

  it("preserves order within a line and ignores unrelated attributes", () => {
    const filePath = path.join(tempRoot, "ordered.attributes");
    fs.writeFileSync(
      filePath,
      [
        "# Generated sources",
        "",
        "*.tsx linguist-generated=false linguist-generated=true",
        "src/** linguist-generated=true linguist-generated=false text=auto",
        "src/app.tsx linguist-vendored",
        "src/app.tsx linguist-generated=false",
      ].join("\n"),
    );
    expect(parseGitattributesLinguistPaths(filePath, SOURCE_PATHS)).toEqual([
      "app.tsx",
      "src/app.tsx",
      "other/file.tsx",
    ]);
  });

  it("keeps root anchoring and does not make directory attributes recursive", () => {
    const filePath = path.join(tempRoot, "paths.attributes");
    fs.writeFileSync(filePath, "/app.tsx linguist-generated\nsrc/ linguist-vendored\n");
    expect(parseGitattributesLinguistPaths(filePath, SOURCE_PATHS)).toEqual(["app.tsx"]);
  });

  it("matches quoted paths with spaces without changing attribute name case", () => {
    const filePath = path.join(tempRoot, "quoted.attributes");
    fs.writeFileSync(
      filePath,
      [
        "*.tsx linguist-generated",
        '"src/with space.tsx" !linguist-generated',
        "src/other.tsx Linguist-Generated=false",
      ].join("\n"),
    );
    expect(
      parseGitattributesLinguistPaths(filePath, ["src/with space.tsx", "src/other.tsx"]),
    ).toEqual(["src/other.tsx"]);
  });

  it("treats parentheses as literal Git pattern characters", () => {
    const filePath = path.join(tempRoot, "literal.attributes");
    fs.writeFileSync(filePath, "src/(app).tsx linguist-generated\n");
    expect(parseGitattributesLinguistPaths(filePath, ["src/app.tsx", "src/(app).tsx"])).toEqual([
      "src/(app).tsx",
    ]);
  });

  it("returns no ignored paths when the file is missing", () => {
    expect(parseGitattributesLinguistPaths(path.join(tempRoot, "missing"), SOURCE_PATHS)).toEqual(
      [],
    );
  });
});
