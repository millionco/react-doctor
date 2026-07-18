import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@react-doctor/core";
import type { ReactDoctorConfig } from "@react-doctor/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { inspect } from "../../src/inspect.js";
import { commitAll, initGitRepo, writeFile, writeJson } from "./_helpers.js";

const RULE = "react-doctor/no-array-index-as-key";
const CONFIG_OVERRIDE: ReactDoctorConfig = { rules: { [RULE]: "warn" } };
const SOURCE =
  "export const Rows = ({ rows }) => <ul>{rows.map((row, index) => <li key={index}>{row}</li>)}</ul>;\n";

describe("baseline pure renames", () => {
  let directory: string;

  beforeEach(() => {
    clearConfigCache();
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-baseline-rename-"));
    writeJson(path.join(directory, "package.json"), {
      name: "baseline-rename",
      dependencies: { react: "^19.0.0", "react-dom": "^19.0.0" },
    });
    writeJson(path.join(directory, "tsconfig.json"), {
      compilerOptions: { jsx: "preserve", target: "es2022", module: "esnext" },
    });
  });

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it("matches an unchanged finding at its old baseline path", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const oldPath = path.join(directory, "src/old-rows.tsx");
      const newPath = path.join(directory, "src/new-rows.tsx");
      writeFile(oldPath, SOURCE);
      initGitRepo(directory);
      const baseRef = commitAll(directory, "base");
      fs.renameSync(oldPath, newPath);
      writeFile(path.join(directory, "src/unrelated-untracked.tsx"), "export const value = 1;\n");

      const result = await inspect(directory, {
        lint: true,
        deadCode: false,
        noScore: true,
        silent: true,
        includePaths: ["src/new-rows.tsx"],
        baseline: { ref: baseRef },
        configOverride: CONFIG_OVERRIDE,
      });

      expect(result.baselineDelta?.baseTotalCount).toBeGreaterThan(0);
      expect(result.baselineDelta?.crossFileMatchCount).toBeGreaterThan(0);
      expect(
        result.diagnostics.filter((diagnostic) => diagnostic.rule === "no-array-index-as-key"),
      ).toHaveLength(0);
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it("counts a deleted finding as fixed without requiring a head file", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const deletedPath = path.join(directory, "src/deleted-rows.tsx");
      writeFile(deletedPath, SOURCE);
      initGitRepo(directory);
      const baseRef = commitAll(directory, "base");
      fs.rmSync(deletedPath);

      const result = await inspect(directory, {
        lint: true,
        deadCode: false,
        noScore: true,
        silent: true,
        includePaths: ["src/deleted-rows.tsx"],
        baseline: { ref: baseRef },
        configOverride: CONFIG_OVERRIDE,
      });

      expect(result.baselineDelta?.fixedCount).toBeGreaterThan(0);
      expect(result.diagnostics).toHaveLength(0);
    } finally {
      consoleSpy.mockRestore();
    }
  });
});
