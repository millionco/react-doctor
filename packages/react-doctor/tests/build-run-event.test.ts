import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import type { Diagnostic, InspectResult, ProjectInfo } from "@react-doctor/core";
import { buildRunEventAttributes } from "../src/cli/utils/build-run-event.js";
import type { RunEventInput } from "../src/cli/utils/build-run-event.js";
import { ACTION_INPUT_ENVIRONMENT_VARIABLES } from "../src/cli/utils/is-ci-environment.js";

// Cleared per test so the host CI environment can't leak into the CI/action
// attribute assertions.
const ENV_VARS = [
  "GITHUB_ACTIONS",
  "GITHUB_EVENT_NAME",
  "GITHUB_EVENT_PATH",
  "RUNNER_OS",
  "REACT_DOCTOR_GITHUB_ACTION",
  ...Object.values(ACTION_INPUT_ENVIRONMENT_VARIABLES),
] as const;

const projectInfo: ProjectInfo = {
  rootDirectory: "/workspace/project",
  projectName: "my-app",
  reactVersion: "18.3.1",
  reactMajorVersion: 18,
  tailwindVersion: null,
  zodVersion: null,
  zodMajorVersion: null,
  framework: "nextjs",
  hasTypeScript: true,
  hasReactCompiler: false,
  hasTanStackQuery: false,
  preactVersion: null,
  preactMajorVersion: null,
  nextjsVersion: null,
  nextjsMajorVersion: null,
  hasReactNativeWorkspace: false,
  expoVersion: null,
  shopifyFlashListVersion: null,
  shopifyFlashListMajorVersion: null,
  hasReanimated: false,
  isPreES2023Target: false,
  sourceFileCount: 100,
};

const buildDiagnostic = (overrides: Partial<Diagnostic> = {}): Diagnostic => ({
  filePath: "src/App.tsx",
  plugin: "react-doctor",
  rule: "no-array-index-as-key",
  severity: "warning",
  message: "Array index used as a key",
  help: "Use a stable id",
  line: 1,
  column: 1,
  category: "Correctness",
  ...overrides,
});

const buildResult = (overrides: Partial<InspectResult> = {}): InspectResult => ({
  diagnostics: [],
  score: null,
  skippedChecks: [],
  project: projectInfo,
  elapsedMilliseconds: 1200,
  scannedFileCount: 10,
  scanElapsedMilliseconds: 900,
  ...overrides,
});

const baseInput = (overrides: Partial<RunEventInput> = {}): RunEventInput => ({
  mode: "full",
  parallel: true,
  workerCount: 4,
  lint: true,
  deadCode: true,
  scoreOnly: false,
  noScore: false,
  respectInlineDisables: true,
  showWarnings: true,
  ignoredTagCount: 0,
  hasCustomConfig: false,
  userConfig: null,
  didLintFail: false,
  lintFailureReasonKind: null,
  lintPartialFailureCount: 0,
  didDeadCodeFail: false,
  ...overrides,
});

describe("buildRunEventAttributes", () => {
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = {};
    for (const name of ENV_VARS) {
      savedEnv[name] = process.env[name];
      delete process.env[name];
    }
  });

  afterEach(() => {
    for (const name of ENV_VARS) {
      const previous = savedEnv[name];
      if (previous === undefined) delete process.env[name];
      else process.env[name] = previous;
    }
  });

  it("marks a finding-free run clean and drops absent CI signals", () => {
    const attributes = buildRunEventAttributes(baseInput({ result: buildResult() }));
    expect(attributes.outcome).toBe("clean");
    expect(attributes.scanClean).toBe(true);
    expect(attributes.totalDiagnostics).toBe(0);
    expect(attributes.exitCode).toBe(0);
    expect(attributes.wouldBlock).toBe(false);
    // No GitHub signals in the cleared env -> these are dropped, not "null".
    expect(attributes.actorAssociation).toBeUndefined();
    expect(attributes.runnerOs).toBeUndefined();
    expect(attributes.versionPin).toBeUndefined();
  });

  it("rolls up diagnostics by severity, rule, and category", () => {
    // Pin the gate to `none` so the error diagnostic below doesn't flip the
    // outcome to "blocked" (default `blocking` is `error`); this test is
    // about the rollups, not the gate.
    process.env[ACTION_INPUT_ENVIRONMENT_VARIABLES.blocking] = "none";
    const result = buildResult({
      diagnostics: [
        buildDiagnostic({ severity: "error", rule: "no-foo", category: "Performance" }),
        buildDiagnostic({ severity: "warning", rule: "no-foo", category: "Performance" }),
        buildDiagnostic({
          severity: "warning",
          rule: "no-bar",
          category: "Correctness",
          filePath: "src/B.tsx",
        }),
      ],
      score: { score: 73, label: "Fair" },
    });
    const attributes = buildRunEventAttributes(baseInput({ result }));
    expect(attributes.outcome).toBe("ok");
    expect(attributes.totalDiagnostics).toBe(3);
    expect(attributes.errorCount).toBe(1);
    expect(attributes.warningCount).toBe(2);
    expect(attributes.affectedFiles).toBe(2);
    expect(attributes.distinctRulesFired).toBe(2);
    expect(attributes.topRule).toBe("react-doctor/no-foo");
    expect(attributes["diag.category.performance"]).toBe(2);
    expect(attributes["diag.category.correctness"]).toBe(1);
    expect(attributes.score).toBe(73);
    expect(attributes.scoreLabel).toBe("Fair");
    expect(attributes.scoreAvailable).toBe(true);
  });

  it("flags a blocking run when the action blocking gate would trip", () => {
    process.env[ACTION_INPUT_ENVIRONMENT_VARIABLES.blocking] = "error";
    const result = buildResult({ diagnostics: [buildDiagnostic({ severity: "error" })] });
    const attributes = buildRunEventAttributes(baseInput({ result }));
    expect(attributes.blocking).toBe("error");
    expect(attributes.wouldBlock).toBe(true);
    expect(attributes.outcome).toBe("blocked");
    expect(attributes.exitCode).toBe(1);
  });

  it("derives wouldBlock from the CI-failure surface, not the full diagnostic list", () => {
    process.env[ACTION_INPUT_ENVIRONMENT_VARIABLES.blocking] = "error";
    const result = buildResult({
      diagnostics: [buildDiagnostic({ severity: "error", rule: "no-foo" })],
    });
    // No surface exclusion: the error trips the gate.
    expect(buildRunEventAttributes(baseInput({ result })).wouldBlock).toBe(true);
    // Excluding the rule from the `ciFailure` surface (what the real CLI gate
    // does for weak-signal `design`-tagged rules) -> the wide event must agree
    // the run doesn't block, instead of disagreeing with the actual exit code.
    const excluded = buildRunEventAttributes(
      baseInput({
        result,
        userConfig: { surfaces: { ciFailure: { excludeRules: ["react-doctor/no-foo"] } } },
      }),
    );
    expect(excluded.wouldBlock).toBe(false);
    expect(excluded.outcome).toBe("ok");
    expect(excluded.exitCode).toBe(0);
  });

  it("never reports a blocked run in score-only mode (matches the CLI exit guard)", () => {
    process.env[ACTION_INPUT_ENVIRONMENT_VARIABLES.blocking] = "error";
    const result = buildResult({ diagnostics: [buildDiagnostic({ severity: "error" })] });
    // A normal run with these findings blocks...
    expect(buildRunEventAttributes(baseInput({ result })).wouldBlock).toBe(true);
    // ...but `scoreOnly` runs never raise a non-zero exit, so the wide event
    // must not claim blocked/exitCode 1 when the process actually exits 0.
    const scoreOnly = buildRunEventAttributes(baseInput({ result, scoreOnly: true }));
    expect(scoreOnly.wouldBlock).toBe(false);
    expect(scoreOnly.outcome).toBe("ok");
    expect(scoreOnly.exitCode).toBe(0);
  });

  it("records the error taxonomy on the failure path", () => {
    const attributes = buildRunEventAttributes(
      baseInput({ result: undefined, error: new TypeError("boom") }),
    );
    expect(attributes.outcome).toBe("error");
    expect(attributes.knownError).toBe(false);
    expect(attributes.errorTag).toBe("TypeError");
    expect(attributes.exitCode).toBe(1);
    // No result -> no outcome rollups.
    expect(attributes.totalDiagnostics).toBeUndefined();
  });

  it("emits the baseline delta on a computed baseline run", () => {
    const result = buildResult({
      diagnostics: [buildDiagnostic(), buildDiagnostic({ filePath: "src/B.tsx" })],
      baselineDelta: { baseRef: "abc1234", fixedCount: 3, baseTotalCount: 7 },
    });
    const attributes = buildRunEventAttributes(baseInput({ result, mode: "baseline" }));
    expect(attributes["baseline.new"]).toBe(2);
    expect(attributes["baseline.fixed"]).toBe(3);
    expect(attributes["baseline.baseTotal"]).toBe(7);
    expect(attributes["baseline.degraded"]).toBe(false);
  });

  it("marks a degraded baseline run, omits the delta, and never blocks", () => {
    const result = buildResult({ diagnostics: [buildDiagnostic({ severity: "error" })] });
    const attributes = buildRunEventAttributes(
      baseInput({ result, mode: "diff", gateExempt: true }),
    );
    expect(attributes["baseline.degraded"]).toBe(true);
    expect(attributes["baseline.new"]).toBeUndefined();
    expect(attributes["baseline.fixed"]).toBeUndefined();
    // Gate-exempt: the degraded run never blocks even with an error finding.
    expect(attributes.wouldBlock).toBe(false);
  });

  it("captures forwarded action knobs and classifies the version pin", () => {
    process.env[ACTION_INPUT_ENVIRONMENT_VARIABLES.reviewComments] = "false";
    process.env[ACTION_INPUT_ENVIRONMENT_VARIABLES.version] = "latest";
    const attributes = buildRunEventAttributes(baseInput({ result: buildResult() }));
    expect(attributes.reviewComments).toBe(false);
    expect(attributes.versionPin).toBe("latest");
    // `comment` env not set -> dropped, never coerced to a value.
    expect(attributes.comment).toBeUndefined();

    process.env[ACTION_INPUT_ENVIRONMENT_VARIABLES.version] = "1.2.3";
    expect(buildRunEventAttributes(baseInput({ result: buildResult() })).versionPin).toBe("pinned");
    process.env[ACTION_INPUT_ENVIRONMENT_VARIABLES.version] = "./local/pkg";
    expect(buildRunEventAttributes(baseInput({ result: buildResult() })).versionPin).toBe("local");
  });

  it("captures config shape and drops null/undefined-valued attributes", () => {
    const attributes = buildRunEventAttributes(
      baseInput({
        result: buildResult({ scannedFileCount: undefined, scanElapsedMilliseconds: undefined }),
        workerCount: undefined,
        ignoredTagCount: 2,
        hasCustomConfig: true,
        userConfig: { rules: { "react-doctor/no-foo": "off", "react-doctor/no-bar": "error" } },
      }),
    );
    expect(attributes.mode).toBe("full");
    expect(attributes.rulesConfigured).toBe(2);
    expect(attributes.rulesDisabled).toBe(1);
    expect(attributes.ignoredTagCount).toBe(2);
    expect(attributes.hasCustomConfig).toBe(true);
    expect(attributes.workerCount).toBeUndefined();
    expect(attributes.scannedFileCount).toBeUndefined();
    expect(attributes.scanPhaseMs).toBeUndefined();
  });
});
