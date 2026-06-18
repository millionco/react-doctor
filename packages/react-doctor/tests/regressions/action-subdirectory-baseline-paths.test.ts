/**
 * Regression for #858: a GitHub Action scan of a subdirectory
 * (`directory: UI`) in baseline mode reported every pre-existing issue in
 * touched files as newly introduced.
 *
 * Root cause: the action wrote repo-root-relative changed-file paths
 * (`UI/src/widget.tsx`) into `--changed-files-from`, but the CLI resolves
 * those entries relative to the *scanned* directory. Scanning `UI/`, the
 * path doubled to `UI/UI/src/widget.tsx`, so baseline base reads via
 * `git show <base>:./UI/src/widget.tsx` (cwd `UI/`) missed →
 * `baseTotalCount: 0` → every finding looked new.
 *
 * The fix strips the `directory` prefix in the action so paths are
 * scan-relative (`src/widget.tsx`) — exactly what `react-doctor --scope
 * changed` produces natively. This test drives the CLI consumer the way
 * the action does (subdirectory scan + `includePaths` + `baseline`) and
 * proves the two path forms diverge at the base read.
 */

import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it, vi } from "vite-plus/test";
import { inspect } from "../../src/inspect.js";
import { clearConfigCache } from "@react-doctor/core";
import type { ReactDoctorConfig } from "@react-doctor/core";
import { commitAll, initGitRepo, writeFile, writeJson } from "./_helpers.js";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rd-858-subdir-baseline-"));

afterAll(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

// `no-array-index-key` fires once per `key={index}` usage, so the finding
// count is deterministic: N usages → N diagnostics. It's `defaultEnabled:
// false`, so the config override turns it on for both the head and base
// passes (baseline reuses the same user config).
const RULE = "react-doctor/no-array-index-key";
const CONFIG_OVERRIDE: ReactDoctorConfig = { rules: { [RULE]: "warn" } };

// One `key={index}` per mapped row → exactly `findingCount` diagnostics.
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

describe("#858: subdirectory baseline resolves changed-file paths against the scan dir", () => {
  it("scan-relative paths read base content; repo-relative paths miss it", async () => {
    clearConfigCache();
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const repoDir = path.join(tempRoot, "monorepo");
    const uiDir = path.join(repoDir, "UI");
    const widgetRelative = path.join("src", "widget.tsx");
    try {
      // A monorepo whose React app lives under UI/ (git root is the repo root).
      writeJson(path.join(repoDir, "package.json"), { name: "monorepo-root", private: true });
      writeJson(path.join(uiDir, "package.json"), {
        name: "ui",
        dependencies: { react: "^19.0.0", "react-dom": "^19.0.0" },
      });
      writeJson(path.join(uiDir, "tsconfig.json"), {
        compilerOptions: { jsx: "preserve", strict: false, target: "es2022", module: "esnext" },
      });

      // Base: two pre-existing index-key findings, committed.
      writeFile(path.join(uiDir, widgetRelative), widget(2));
      initGitRepo(repoDir);
      const baseRef = commitAll(repoDir, "init UI app with two findings");

      // Head: add a third finding to the same file (the PR's change).
      writeFile(path.join(uiDir, widgetRelative), widget(3));

      const scanUi = (includePaths: string[], baseline: { ref: string } | null) =>
        inspect(uiDir, {
          lint: true,
          deadCode: false,
          noScore: true,
          silent: true,
          includePaths,
          baseline,
          configOverride: CONFIG_OVERRIDE,
        });
      const findings = (result: Awaited<ReturnType<typeof scanUi>>): number =>
        result.diagnostics.filter((diagnostic) => diagnostic.rule === "no-array-index-key").length;

      // A baseline-free head scan = the full finding set in the changed file
      // (relational reference, so the assertions don't hard-code the rule's
      // per-usage report count).
      const headOnly = await scanUi([widgetRelative], null);
      expect(headOnly.skippedChecks).not.toContain("lint");
      const headTotal = findings(headOnly);
      expect(headTotal).toBeGreaterThan(0);

      // The fix: scan-relative paths, as the patched action now emits.
      const fixed = await scanUi([widgetRelative], { ref: baseRef });
      expect(fixed.baselineDelta).toBeDefined();
      // Base content WAS read (nonzero base total) — the core of the fix.
      expect(fixed.baselineDelta?.baseTotalCount).toBeGreaterThan(0);
      // The PR-introduced findings show...
      expect(findings(fixed)).toBeGreaterThan(0);
      // ...but pre-existing ones are subtracted, not re-reported as new.
      expect(findings(fixed)).toBeLessThan(headTotal);

      // The bug: repo-relative paths (the pre-fix action output) double the
      // prefix, so `git show <base>:./UI/src/widget.tsx` misses and the base
      // count collapses to 0 — the exact signal in #858 (every finding "new").
      const buggy = await scanUi([path.join("UI", widgetRelative)], { ref: baseRef });
      expect(buggy.baselineDelta?.baseTotalCount).toBe(0);
    } finally {
      consoleSpy.mockRestore();
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
  });
});
