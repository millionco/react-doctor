import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { resolveLintIncludePaths } from "../src/resolve-lint-include-paths.js";

let tempDirectory: string;

const writeFixtureFile = (relativePath: string): void => {
  const absolutePath = path.join(tempDirectory, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, "export const value = 1;\n");
};

describe("resolveLintIncludePaths", () => {
  beforeEach(() => {
    tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "rd-lint-includes-"));
  });

  afterEach(() => {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("keeps all supported source files when ignore.files materializes a lint list", () => {
    for (const relativePath of [
      "src/App.tsx",
      "src/ignored.tsx",
      "middleware.ts",
      "src/proxy.mjs",
      "src/server.ts",
      "nested/middleware.ts",
      ".next/proxy.ts",
      "dist/middleware.ts",
    ]) {
      writeFixtureFile(relativePath);
    }

    const includedPaths = resolveLintIncludePaths(tempDirectory, {
      ignore: { files: ["src/ignored.tsx"] },
    });

    expect(includedPaths?.toSorted()).toEqual([
      "middleware.ts",
      "nested/middleware.ts",
      "src/App.tsx",
      "src/proxy.mjs",
      "src/server.ts",
    ]);
  });
});
