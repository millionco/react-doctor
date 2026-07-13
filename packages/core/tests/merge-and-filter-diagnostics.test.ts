import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";

import type { Diagnostic, ReactDoctorConfig } from "@react-doctor/core";
import {
  buildDiagnosticPipeline,
  clearAutoSuppressionCaches,
  createNodeReadFileLinesSync,
  mergeAndFilterDiagnostics,
} from "@react-doctor/core";

// Inlined to avoid coupling core tests to the react-doctor regressions
// test harness (which carries its own runOxlint + git-spawn surface).
const writeFile = (filePath: string, contents: string): void => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
};

const buildDiagnostic = (overrides: Partial<Diagnostic> = {}): Diagnostic => ({
  filePath: "src/app.tsx",
  plugin: "react-doctor",
  rule: "test-rule",
  severity: "error",
  message: "x",
  help: "",
  line: 1,
  column: 1,
  category: "Test",
  ...overrides,
});

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rd-merge-and-filter-"));

afterAll(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

const setupCase = (caseId: string, fileContents: string): string => {
  const projectDir = path.join(tempRoot, caseId);
  writeFile(path.join(projectDir, "src", "app.tsx"), fileContents);
  return projectDir;
};

const baseDiagnostic = (overrides: Partial<Diagnostic> = {}): Diagnostic =>
  buildDiagnostic({ rule: "no-derived-state-effect", line: 2, ...overrides });

interface ConditionalHookDiagnostics {
  compiler: Diagnostic;
  reactDoctor: Diagnostic;
}

const buildConditionalHookDiagnostics = (
  filePath: string,
  line: number = 2,
): ConditionalHookDiagnostics => ({
  compiler: buildDiagnostic({
    filePath,
    plugin: "react-hooks-js",
    rule: "hooks",
    message: "Hooks must always be called in a consistent order",
    line,
  }),
  reactDoctor: buildDiagnostic({
    filePath,
    rule: "rules-of-hooks",
    message: "React Hook is called conditionally",
    line,
  }),
});

describe("mergeAndFilterDiagnostics — respectInlineDisables option", () => {
  it("filters react-doctor-disable comments by default (respectInlineDisables defaults to true)", () => {
    const projectDir = setupCase(
      "default-respects-disables",
      `// react-doctor-disable-next-line react-doctor/no-derived-state-effect\nconst x = 1;\n`,
    );
    const filtered = mergeAndFilterDiagnostics(
      [baseDiagnostic()],
      projectDir,
      null,
      createNodeReadFileLinesSync(projectDir),
    );
    expect(filtered).toHaveLength(0);
  });

  it("audit mode (respectInlineDisables=false) bypasses react-doctor-disable comments too", () => {
    const projectDir = setupCase(
      "audit-bypasses-disables",
      `// react-doctor-disable-next-line react-doctor/no-derived-state-effect\nconst x = 1;\n`,
    );
    const filtered = mergeAndFilterDiagnostics(
      [baseDiagnostic()],
      projectDir,
      null,
      createNodeReadFileLinesSync(projectDir),
      { respectInlineDisables: false },
    );
    expect(filtered).toHaveLength(1);
  });

  it("audit mode still honors config-level ignore.rules and ignore.files", () => {
    const projectDir = setupCase("audit-honors-config-ignores", `const x = 1;\n`);
    const filtered = mergeAndFilterDiagnostics(
      [baseDiagnostic({ filePath: "src/skip.tsx", line: 1 })],
      projectDir,
      { ignore: { files: ["src/skip.tsx"] } },
      createNodeReadFileLinesSync(projectDir),
      { respectInlineDisables: false },
    );
    expect(filtered).toHaveLength(0);
  });
});

describe("mergeAndFilterDiagnostics — conditional Hook deduplication", () => {
  it("prefers the React Doctor diagnostic when both findings survive", () => {
    const projectDir = setupCase("hook-dedupe-default", "const value = 1;\n");
    const diagnostics = buildConditionalHookDiagnostics("src/app.tsx", 1);

    expect(
      mergeAndFilterDiagnostics(
        [diagnostics.compiler, diagnostics.reactDoctor],
        projectDir,
        null,
        createNodeReadFileLinesSync(projectDir),
      ),
    ).toEqual([{ ...diagnostics.reactDoctor }]);
  });

  it("preserves the compiler finding when test-noise suppression drops the native rule", () => {
    const projectDir = setupCase("hook-dedupe-test-noise", "const value = 1;\n");
    const diagnostics = buildConditionalHookDiagnostics("src/app.test.tsx", 1);

    expect(
      mergeAndFilterDiagnostics(
        [diagnostics.compiler, diagnostics.reactDoctor],
        projectDir,
        null,
        createNodeReadFileLinesSync(projectDir),
      ),
    ).toEqual([{ ...diagnostics.compiler, fileContext: "test" }]);
  });

  it("preserves the compiler finding when config ignores the native rule", () => {
    const projectDir = setupCase("hook-dedupe-config", "const value = 1;\n");
    const diagnostics = buildConditionalHookDiagnostics("src/app.tsx", 1);

    expect(
      mergeAndFilterDiagnostics(
        [diagnostics.compiler, diagnostics.reactDoctor],
        projectDir,
        { ignore: { rules: ["react-doctor/rules-of-hooks"] } },
        createNodeReadFileLinesSync(projectDir),
      ),
    ).toEqual([
      expect.objectContaining({
        plugin: diagnostics.compiler.plugin,
        rule: diagnostics.compiler.rule,
      }),
    ]);
  });

  it("preserves the compiler finding when a path override ignores the native rule", () => {
    const projectDir = setupCase("hook-dedupe-path-override", "const value = 1;\n");
    const diagnostics = buildConditionalHookDiagnostics("src/app.tsx", 1);

    expect(
      mergeAndFilterDiagnostics(
        [diagnostics.compiler, diagnostics.reactDoctor],
        projectDir,
        {
          ignore: {
            overrides: [{ files: ["src/**"], rules: ["react-doctor/rules-of-hooks"] }],
          },
        },
        createNodeReadFileLinesSync(projectDir),
      ),
    ).toEqual([diagnostics.compiler]);
  });

  it("preserves the compiler finding when an inline directive disables the native rule", () => {
    const projectDir = setupCase(
      "hook-dedupe-inline",
      "// react-doctor-disable-next-line react-doctor/rules-of-hooks\nconst value = 1;\n",
    );
    const diagnostics = buildConditionalHookDiagnostics("src/app.tsx");

    expect(
      mergeAndFilterDiagnostics(
        [diagnostics.compiler, diagnostics.reactDoctor],
        projectDir,
        null,
        createNodeReadFileLinesSync(projectDir),
      ),
    ).toEqual([
      expect.objectContaining({
        plugin: diagnostics.compiler.plugin,
        rule: diagnostics.compiler.rule,
      }),
    ]);
  });

  it("preserves the native finding when config ignores only the compiler rule", () => {
    const projectDir = setupCase("hook-dedupe-compiler-config", "const value = 1;\n");
    const diagnostics = buildConditionalHookDiagnostics("src/app.tsx", 1);

    expect(
      mergeAndFilterDiagnostics(
        [diagnostics.compiler, diagnostics.reactDoctor],
        projectDir,
        { ignore: { rules: ["react-hooks-js/hooks"] } },
        createNodeReadFileLinesSync(projectDir),
      ),
    ).toEqual([diagnostics.reactDoctor]);
  });

  it("preserves a lower-priority related finding when config ignores the preferred rule", () => {
    const projectDir = setupCase("derived-state-dedupe-config", "const value = 1;\n");
    const preferredDiagnostic = buildDiagnostic({
      rule: "no-adjust-state-on-prop-change",
      offset: 100,
      length: 12,
    });
    const fallbackDiagnostic = buildDiagnostic({
      rule: "no-derived-state",
      offset: 100,
      length: 12,
    });

    expect(
      mergeAndFilterDiagnostics(
        [fallbackDiagnostic, preferredDiagnostic],
        projectDir,
        { ignore: { rules: ["react-doctor/no-adjust-state-on-prop-change"] } },
        createNodeReadFileLinesSync(projectDir),
      ),
    ).toEqual([fallbackDiagnostic]);
  });

  it("deduplicates related findings after a severity override", () => {
    const projectDir = setupCase("derived-state-dedupe-severity", "const value = 1;\n");
    const preferredDiagnostic = buildDiagnostic({
      rule: "no-adjust-state-on-prop-change",
      offset: 100,
      length: 12,
    });
    const fallbackDiagnostic = buildDiagnostic({
      rule: "no-derived-state",
      severity: "warning",
      offset: 100,
      length: 12,
    });

    expect(
      mergeAndFilterDiagnostics(
        [fallbackDiagnostic, preferredDiagnostic],
        projectDir,
        { rules: { "react-doctor/no-adjust-state-on-prop-change": "error" } },
        createNodeReadFileLinesSync(projectDir),
      ),
    ).toEqual([{ ...preferredDiagnostic, severity: "error" }]);
  });

  it("carries a user-escalated error onto the preferred finding it collapses into", () => {
    const projectDir = setupCase("derived-state-dedupe-escalated-fallback", "const value = 1;\n");
    const preferredDiagnostic = buildDiagnostic({
      rule: "no-adjust-state-on-prop-change",
      severity: "warning",
      offset: 100,
      length: 12,
    });
    const escalatedFallbackDiagnostic = buildDiagnostic({
      rule: "no-derived-state",
      severity: "warning",
      offset: 100,
      length: 12,
    });

    expect(
      mergeAndFilterDiagnostics(
        [escalatedFallbackDiagnostic, preferredDiagnostic],
        projectDir,
        { rules: { "react-doctor/no-derived-state": "error" } },
        createNodeReadFileLinesSync(projectDir),
      ),
    ).toEqual([{ ...preferredDiagnostic, severity: "error" }]);
  });
});

describe("mergeAndFilterDiagnostics — test-noise tag auto-suppression for async-parallel", () => {
  const projectDir = path.join(tempRoot, "test-noise-async-parallel");
  const readNoop = () => null;
  const asyncParallelDiagnostic = (filePath: string): Diagnostic =>
    buildDiagnostic({
      rule: "async-parallel",
      filePath,
      line: 1,
      column: 1,
    });

  it("auto-suppresses async-parallel in `*.test.tsx` files", () => {
    clearAutoSuppressionCaches();
    const filtered = mergeAndFilterDiagnostics(
      [asyncParallelDiagnostic("src/dashboard.test.tsx")],
      projectDir,
      null,
      readNoop,
      { respectInlineDisables: false },
    );
    expect(filtered).toHaveLength(0);
  });

  it("auto-suppresses async-parallel inside `__tests__/` directories", () => {
    clearAutoSuppressionCaches();
    const filtered = mergeAndFilterDiagnostics(
      [asyncParallelDiagnostic("src/utils/__tests__/load-data.ts")],
      projectDir,
      null,
      readNoop,
      { respectInlineDisables: false },
    );
    expect(filtered).toHaveLength(0);
  });

  it("auto-suppresses async-parallel inside Playwright/Cypress/e2e directories", () => {
    clearAutoSuppressionCaches();
    const filtered = mergeAndFilterDiagnostics(
      [
        asyncParallelDiagnostic("playwright/checkout.spec.ts"),
        asyncParallelDiagnostic("cypress/e2e/login.cy.ts"),
        asyncParallelDiagnostic("e2e/onboarding.ts"),
      ],
      projectDir,
      null,
      readNoop,
      { respectInlineDisables: false },
    );
    expect(filtered).toHaveLength(0);
  });

  it("auto-suppresses async-parallel for Windows-slashed test paths", () => {
    clearAutoSuppressionCaches();
    const filtered = mergeAndFilterDiagnostics(
      [asyncParallelDiagnostic("src\\components\\Button.test.tsx")],
      projectDir,
      null,
      readNoop,
      { respectInlineDisables: false },
    );
    expect(filtered).toHaveLength(0);
  });

  it("still surfaces async-parallel in plain production files", () => {
    clearAutoSuppressionCaches();
    const filtered = mergeAndFilterDiagnostics(
      [asyncParallelDiagnostic("src/server/load-dashboard.ts")],
      projectDir,
      null,
      readNoop,
      { respectInlineDisables: false },
    );
    expect(filtered).toHaveLength(1);
  });
});

describe("buildDiagnosticPipeline — summarizeSuppressions", () => {
  const readNoop = () => null;
  const buildPipeline = (
    userConfig: ReactDoctorConfig | null,
    rootDirectory: string = path.join(tempRoot, "suppression-summary"),
    readFileLinesSync: (filePath: string) => string[] | null = readNoop,
  ) =>
    buildDiagnosticPipeline({
      rootDirectory,
      userConfig,
      readFileLinesSync,
      respectInlineDisables: true,
      showWarnings: true,
    });

  it("tallies rules dropped via severity `off` and `ignore.rules` as `config`", () => {
    const pipeline = buildPipeline({
      rules: { "react-doctor/no-derived-state-effect": "off" },
      ignore: { rules: ["react-doctor/test-rule"] },
    });
    expect(pipeline.apply(baseDiagnostic())).toBeNull();
    expect(pipeline.apply(baseDiagnostic({ filePath: "src/other.tsx" }))).toBeNull();
    expect(pipeline.apply(buildDiagnostic({ line: 3 }))).toBeNull();
    expect(pipeline.summarizeSuppressions()).toEqual([
      { rule: "react-doctor/no-derived-state-effect", source: "config", count: 2 },
      { rule: "react-doctor/test-rule", source: "config", count: 1 },
    ]);
  });

  it("tallies per-path `ignore.overrides` drops as `override` and leaves survivors uncounted", () => {
    const pipeline = buildPipeline({
      ignore: {
        overrides: [{ files: ["src/legacy/**"], rules: ["react-doctor/no-derived-state-effect"] }],
      },
    });
    expect(pipeline.apply(baseDiagnostic({ filePath: "src/legacy/app.tsx" }))).toBeNull();
    expect(pipeline.apply(baseDiagnostic())).not.toBeNull();
    expect(pipeline.summarizeSuppressions()).toEqual([
      { rule: "react-doctor/no-derived-state-effect", source: "override", count: 1 },
    ]);
  });

  it("tallies inline disable comments as `inline`", () => {
    const projectDir = setupCase(
      "suppression-summary-inline",
      `// react-doctor-disable-next-line react-doctor/no-derived-state-effect\nconst x = 1;\n`,
    );
    const pipeline = buildPipeline(null, projectDir, createNodeReadFileLinesSync(projectDir));
    expect(pipeline.apply(baseDiagnostic())).toBeNull();
    expect(pipeline.summarizeSuppressions()).toEqual([
      { rule: "react-doctor/no-derived-state-effect", source: "inline", count: 1 },
    ]);
  });

  it("tallies foreign eslint-disable comments honored for compiler rules as `foreign-inline`", () => {
    const projectDir = setupCase(
      "suppression-summary-foreign-inline",
      `// eslint-disable-next-line react-hooks/refs\nconst width = widthRef.current;\n`,
    );
    const pipeline = buildPipeline(null, projectDir, createNodeReadFileLinesSync(projectDir));
    expect(pipeline.apply(baseDiagnostic({ plugin: "react-hooks-js", rule: "refs" }))).toBeNull();
    expect(pipeline.summarizeSuppressions()).toEqual([
      { rule: "react-hooks-js/refs", source: "foreign-inline", count: 1 },
    ]);
  });

  it("does not count file-level `ignore.files` drops — they reject a path, not a rule", () => {
    const pipeline = buildPipeline({ ignore: { files: ["src/skip.tsx"] } });
    expect(pipeline.apply(baseDiagnostic({ filePath: "src/skip.tsx" }))).toBeNull();
    expect(pipeline.summarizeSuppressions()).toEqual([]);
  });
});
