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
  scope: "full",
  parallel: true,
  workerCount: 4,
  lint: true,
  deadCode: true,
  scoreOnly: false,
  noScore: false,
  respectInlineDisables: true,
  showWarnings: true,
  usedOutputDir: false,
  ignoredTagCount: 0,
  hasCustomConfig: false,
  userConfig: null,
  didLintFail: false,
  lintFailureReasonKind: null,
  lintPartialFailureCount: 0,
  didDeadCodeFail: false,
  deadCodeOverlapped: false,
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

  it("records whether the dead-code pass overlapped lint, and drops it on the failure path", () => {
    expect(
      buildRunEventAttributes(baseInput({ result: buildResult(), deadCodeOverlapped: true }))[
        "deadCode.overlapped"
      ],
    ).toBe(true);
    // A false dimension is still emitted (toSpanAttributes only drops null), so
    // overlap-adoption rate is queryable across all scans.
    expect(
      buildRunEventAttributes(baseInput({ result: buildResult(), deadCodeOverlapped: false }))[
        "deadCode.overlapped"
      ],
    ).toBe(false);
    // Failure path (no result) carries no outcome dimensions, so it's dropped.
    expect(
      buildRunEventAttributes(baseInput({ error: new Error("boom") }))["deadCode.overlapped"],
    ).toBeUndefined();
  });

  it("marks a finding-free run clean and drops absent CI signals", () => {
    const attributes = buildRunEventAttributes(baseInput({ result: buildResult() }));
    expect(attributes["outcome.status"]).toBe("clean");
    expect(attributes["outcome.clean"]).toBe(true);
    expect(attributes["diag.total"]).toBe(0);
    expect(attributes["outcome.exitCode"]).toBe(0);
    expect(attributes["outcome.wouldBlock"]).toBe(false);
    // No GitHub signals in the cleared env -> these are dropped, not "null".
    expect(attributes["action.actorAssociation"]).toBeUndefined();
    expect(attributes["action.runnerOs"]).toBeUndefined();
    expect(attributes["action.versionPin"]).toBeUndefined();
    // Nothing fired -> no migration bucket to report (dropped, not "null").
    expect(attributes["migration.largestRuleBucketFiles"]).toBeUndefined();
    expect(attributes["migration.largestRuleBucketRule"]).toBeUndefined();
  });

  it("records the widest-blast-radius rule for migration-scale calibration", () => {
    const diagnostics: Diagnostic[] = [];
    for (let fileIndex = 0; fileIndex < 45; fileIndex += 1) {
      diagnostics.push(
        buildDiagnostic({
          rule: "react-compiler-no-manual-memoization",
          category: "Performance",
          filePath: `src/components/widget-${fileIndex}.tsx`,
        }),
      );
    }
    // A noisier-by-sites but narrow rule must NOT win: blast radius is files.
    diagnostics.push(
      buildDiagnostic({ rule: "no-array-index-as-key", filePath: "src/list.tsx", line: 1 }),
      buildDiagnostic({ rule: "no-array-index-as-key", filePath: "src/list.tsx", line: 2 }),
    );

    const attributes = buildRunEventAttributes(baseInput({ result: buildResult({ diagnostics }) }));

    expect(attributes["migration.largestRuleBucketFiles"]).toBe(45);
    expect(attributes["migration.largestRuleBucketSites"]).toBe(45);
    expect(attributes["migration.largestRuleBucketRule"]).toBe(
      "react-doctor/react-compiler-no-manual-memoization",
    );
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
    expect(attributes["outcome.status"]).toBe("ok");
    expect(attributes["diag.total"]).toBe(3);
    expect(attributes["diag.errors"]).toBe(1);
    expect(attributes["diag.warnings"]).toBe(2);
    expect(attributes["diag.affectedFiles"]).toBe(2);
    expect(attributes["diag.distinctRules"]).toBe(2);
    expect(attributes["diag.topRule"]).toBe("react-doctor/no-foo");
    expect(attributes["diag.category.performance"]).toBe(2);
    expect(attributes["diag.category.correctness"]).toBe(1);
    expect(attributes["score.value"]).toBe(73);
    expect(attributes["score.label"]).toBe("Fair");
    expect(attributes["score.available"]).toBe(true);
  });

  it("flags a blocking run when the action blocking gate would trip", () => {
    process.env[ACTION_INPUT_ENVIRONMENT_VARIABLES.blocking] = "error";
    const result = buildResult({ diagnostics: [buildDiagnostic({ severity: "error" })] });
    const attributes = buildRunEventAttributes(baseInput({ result }));
    expect(attributes["outcome.blocking"]).toBe("error");
    expect(attributes["outcome.wouldBlock"]).toBe(true);
    expect(attributes["outcome.status"]).toBe("blocked");
    expect(attributes["outcome.exitCode"]).toBe(1);
  });

  it("derives wouldBlock from the CI-failure surface, not the full diagnostic list", () => {
    process.env[ACTION_INPUT_ENVIRONMENT_VARIABLES.blocking] = "error";
    const result = buildResult({
      diagnostics: [buildDiagnostic({ severity: "error", rule: "no-foo" })],
    });
    // No surface exclusion: the error trips the gate.
    expect(buildRunEventAttributes(baseInput({ result }))["outcome.wouldBlock"]).toBe(true);
    // Excluding the rule from the `ciFailure` surface (what the real CLI gate
    // does for weak-signal `design`-tagged rules) -> the wide event must agree
    // the run doesn't block, instead of disagreeing with the actual exit code.
    const excluded = buildRunEventAttributes(
      baseInput({
        result,
        userConfig: { surfaces: { ciFailure: { excludeRules: ["react-doctor/no-foo"] } } },
      }),
    );
    expect(excluded["outcome.wouldBlock"]).toBe(false);
    expect(excluded["outcome.status"]).toBe("ok");
    expect(excluded["outcome.exitCode"]).toBe(0);
  });

  it("never reports a blocked run in score-only mode (matches the CLI exit guard)", () => {
    process.env[ACTION_INPUT_ENVIRONMENT_VARIABLES.blocking] = "error";
    const result = buildResult({ diagnostics: [buildDiagnostic({ severity: "error" })] });
    // A normal run with these findings blocks...
    expect(buildRunEventAttributes(baseInput({ result }))["outcome.wouldBlock"]).toBe(true);
    // ...but `scoreOnly` runs never raise a non-zero exit, so the wide event
    // must not claim blocked/exitCode 1 when the process actually exits 0.
    const scoreOnly = buildRunEventAttributes(baseInput({ result, scoreOnly: true }));
    expect(scoreOnly["outcome.wouldBlock"]).toBe(false);
    expect(scoreOnly["outcome.status"]).toBe("ok");
    expect(scoreOnly["outcome.exitCode"]).toBe(0);
  });

  it("records the error taxonomy on the failure path", () => {
    const attributes = buildRunEventAttributes(
      baseInput({ result: undefined, error: new TypeError("boom") }),
    );
    expect(attributes["outcome.status"]).toBe("error");
    expect(attributes["outcome.knownError"]).toBe(false);
    expect(attributes["outcome.errorTag"]).toBe("TypeError");
    expect(attributes["outcome.exitCode"]).toBe(1);
    // No result -> no outcome rollups.
    expect(attributes["diag.total"]).toBeUndefined();
  });

  it("records the supply-chain overlap timeout outcome and drops it when absent", () => {
    // The healthy path reports `false`; the rare hung-socket guard reports
    // `true`. When the field is omitted (failure path / cache hit), it's dropped
    // rather than coerced to a misleading value.
    expect(
      buildRunEventAttributes(
        baseInput({ result: buildResult(), supplyChainOverlapTimedOut: true }),
      )["supplyChain.overlapTimedOut"],
    ).toBe(true);
    expect(
      buildRunEventAttributes(
        baseInput({ result: buildResult(), supplyChainOverlapTimedOut: false }),
      )["supplyChain.overlapTimedOut"],
    ).toBe(false);
    expect(
      buildRunEventAttributes(baseInput({ result: buildResult() }))["supplyChain.overlapTimedOut"],
    ).toBeUndefined();
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
    expect(attributes["outcome.wouldBlock"]).toBe(false);
  });

  it("captures forwarded action knobs and classifies the version pin", () => {
    process.env[ACTION_INPUT_ENVIRONMENT_VARIABLES.reviewComments] = "false";
    process.env[ACTION_INPUT_ENVIRONMENT_VARIABLES.version] = "latest";
    const attributes = buildRunEventAttributes(baseInput({ result: buildResult() }));
    expect(attributes["action.reviewComments"]).toBe(false);
    expect(attributes["action.versionPin"]).toBe("latest");
    // `comment` env not set -> dropped, never coerced to a value.
    expect(attributes["action.comment"]).toBeUndefined();

    process.env[ACTION_INPUT_ENVIRONMENT_VARIABLES.version] = "1.2.3";
    expect(buildRunEventAttributes(baseInput({ result: buildResult() }))["action.versionPin"]).toBe(
      "pinned",
    );
    process.env[ACTION_INPUT_ENVIRONMENT_VARIABLES.version] = "./local/pkg";
    expect(buildRunEventAttributes(baseInput({ result: buildResult() }))["action.versionPin"]).toBe(
      "local",
    );
  });

  it("records lint.droppedFileCount when present and drops it when absent", () => {
    const withDrops = buildRunEventAttributes(
      baseInput({ result: buildResult(), lintDroppedFileCount: 4 }),
    );
    expect(withDrops["lint.droppedFileCount"]).toBe(4);

    // Not passed -> null -> dropped, never coerced to a misleading "null".
    const withoutDrops = buildRunEventAttributes(baseInput({ result: buildResult() }));
    expect(withoutDrops["lint.droppedFileCount"]).toBeUndefined();
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
    expect(attributes["scan.mode"]).toBe("full");
    expect(attributes["scan.rulesConfigured"]).toBe(2);
    expect(attributes["scan.rulesDisabled"]).toBe(1);
    expect(attributes["scan.ignoredTagCount"]).toBe(2);
    expect(attributes["scan.hasCustomConfig"]).toBe(true);
    expect(attributes["scan.workerCount"]).toBeUndefined();
    expect(attributes["scan.fileCount"]).toBeUndefined();
    expect(attributes["timing.scanMs"]).toBeUndefined();
  });
});
