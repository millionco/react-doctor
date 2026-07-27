/**
 * Regression for #1456: when `doctor.config.ts` sets `rootDir` to a
 * subdirectory but the GitHub Action runs with `directory: '.'`, baseline
 * mode degrades even with a full clone and reachable base SHA.
 *
 * Root cause: the Action emits repo-root-relative changed-file paths
 * (`apps/website/vite.config.ts`), but after `resolveScanTarget` applies
 * `rootDir`, the CLI scans from the subdirectory. The baseline comparison
 * checks if the head analyzed the expected files, but `includePaths` still
 * contains repo-relative paths while `analyzedFiles` contains project-
 * relative paths — the mismatch triggers degradation.
 *
 * The fix adjusts changed files to be relative to the resolved directory
 * (after any `rootDir` redirect) before passing them to `inspect()`.
 */

import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it, vi } from "vite-plus/test";
import { inspect } from "../../src/inspect.js";
import { clearConfigCache } from "@react-doctor/core";
import type { ReactDoctorConfig } from "@react-doctor/core";
import { commitAll, initGitRepo, writeFile, writeJson } from "./_helpers.js";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rd-1456-rootdir-baseline-"));

afterAll(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

const RULE = "react-doctor/no-array-index-as-key";
const CONFIG_OVERRIDE: ReactDoctorConfig = { rules: { [RULE]: "warn" } };

const widget = (findingCount: number): string => {
  const rows = Array.from(
    { length: findingCount },
    (_, row) => `      {rows[${row}].map((item, index) => <li key={index}>{item}</li>)}`,
  );
  return [
    "export const Widget = ({ rows }: { rows: string[][] }) => (",
    "  <ul>",
    ...rows,
    "  </ul>",
    ");",
    "",
  ].join("\n");
};

describe("#1456: rootDir redirect with repo-relative changed-file paths", () => {
  it("baseline mode should work when rootDir redirects", async () => {
    clearConfigCache();
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const repoDir = path.join(tempRoot, "monorepo");
    const websiteDir = path.join(repoDir, "apps", "website");
    const widgetRelative = path.join("src", "widget.tsx");
    try {
      writeJson(path.join(repoDir, "package.json"), { name: "monorepo-root", private: true });
      writeJson(path.join(repoDir, "doctor.config.json"), { rootDir: "apps/website" });
      writeJson(path.join(websiteDir, "package.json"), {
        name: "website",
        dependencies: { react: "^19.0.0", "react-dom": "^19.0.0" },
      });
      writeJson(path.join(websiteDir, "tsconfig.json"), {
        compilerOptions: { jsx: "preserve", strict: false, target: "es2022", module: "esnext" },
      });

      writeFile(path.join(websiteDir, widgetRelative), widget(2));
      initGitRepo(repoDir);
      const baseRef = commitAll(repoDir, "init website app with two findings");

      writeFile(path.join(websiteDir, widgetRelative), widget(3));

      const scanRepoRoot = (includePaths: string[], baseline: { ref: string } | null) =>
        inspect(repoDir, {
          lint: true,
          deadCode: false,
          noScore: true,
          silent: true,
          includePaths,
          baseline,
          configOverride: CONFIG_OVERRIDE,
        });
      const findings = (result: Awaited<ReturnType<typeof scanRepoRoot>>): number =>
        result.diagnostics.filter((diagnostic) => diagnostic.rule === "no-array-index-as-key")
          .length;

      const headOnly = await scanRepoRoot([path.join("apps", "website", widgetRelative)], null);
      expect(headOnly.skippedChecks).not.toContain("lint");
      const headTotal = findings(headOnly);
      expect(headTotal).toBeGreaterThan(0);

      const baselineResult = await scanRepoRoot([path.join("apps", "website", widgetRelative)], {
        ref: baseRef,
      });
      expect(baselineResult.baselineDegraded).toBeUndefined();
      expect(baselineResult.baselineDelta).toBeDefined();
      expect(baselineResult.baselineDelta?.baseTotalCount).toBeGreaterThan(0);
      expect(findings(baselineResult)).toBeGreaterThan(0);
      expect(findings(baselineResult)).toBeLessThan(headTotal);
    } finally {
      consoleSpy.mockRestore();
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
  });
});
