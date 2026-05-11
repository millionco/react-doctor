import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { resolveLintIncludePaths } from "../src/utils/resolve-lint-include-paths.js";

const writeFile = (directory: string, relativePath: string, contents: string): void => {
  const filePath = path.join(directory, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
};

describe("resolveLintIncludePaths", () => {
  let directory: string;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-lint-includes-"));
  });

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it("returns undefined when no ignored files are configured", () => {
    expect(resolveLintIncludePaths(directory, null)).toBeUndefined();
    expect(resolveLintIncludePaths(directory, { ignore: { files: [] } })).toBeUndefined();
  });

  it("lists JSX source files through git and removes ignored files", () => {
    runGit(directory, ["init", "-q"]);
    writeFile(directory, "src/app.tsx", "export const App = () => null;\n");
    writeFile(directory, "src/ignored.tsx", "export const Ignored = () => null;\n");
    writeFile(directory, "src/util.ts", "export const util = true;\n");
    runGit(directory, ["add", "."]);

    expect(resolveLintIncludePaths(directory, { ignore: { files: ["src/ignored.tsx"] } })).toEqual([
      "src/app.tsx",
    ]);
  });

  it("falls back to filesystem traversal and skips ignored directories", () => {
    writeFile(directory, "src/app.jsx", "export const App = () => null;\n");
    writeFile(directory, "node_modules/pkg/app.jsx", "export const ignored = true;\n");
    writeFile(directory, ".hidden/app.jsx", "export const hidden = true;\n");

    expect(resolveLintIncludePaths(directory, { ignore: { files: ["src/missing.tsx"] } })).toEqual([
      "src/app.jsx",
    ]);
  });
});

const runGit = (directory: string, args: string[]): void => {
  const result = spawnSync("git", args, { cwd: directory, encoding: "utf-8" });
  if (result.status !== 0) {
    throw new Error(result.stderr.toString());
  }
};
