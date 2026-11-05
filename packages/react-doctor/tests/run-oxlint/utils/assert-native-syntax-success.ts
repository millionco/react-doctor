import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";
import { expect } from "vite-plus/test";

const requireFromTest = createRequire(import.meta.url);
const oxlintBinaryPath = path.join(
  path.dirname(requireFromTest.resolve("oxlint/package.json")),
  "bin",
  "oxlint",
);

export const assertNativeSyntaxSuccess = (rootDirectory: string): void => {
  const configurationPath = path.join(rootDirectory, ".native-syntax-config.json");
  fs.writeFileSync(configurationPath, JSON.stringify({ plugins: [] }));
  const result = spawnSync(
    process.execPath,
    [
      oxlintBinaryPath,
      "--config",
      configurationPath,
      "--allow",
      "all",
      "--disable-nested-config",
      "--format",
      "json",
      path.join(rootDirectory, "src"),
    ],
    { cwd: rootDirectory, encoding: "utf8" },
  );
  expect(result.error).toBeUndefined();
  expect(result.status, result.stdout + result.stderr).toBe(0);
  const output = JSON.parse(result.stdout);
  expect(output.number_of_files).toBeGreaterThan(0);
  expect(output.diagnostics).toEqual([]);
};
