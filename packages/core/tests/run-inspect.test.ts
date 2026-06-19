import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import { afterAll, describe, expect, it } from "vite-plus/test";
import type { Diagnostic, ProjectInfo, ReactDoctorConfig } from "@react-doctor/core";
import {
  DeadCodeAnalysisFailed,
  GitInvocationFailed,
  NoReactDependency,
  OxlintSpawnFailed,
  ReactDoctorError,
} from "../src/errors.js";
import { runInspect, type InspectInput } from "../src/run-inspect.js";
import {
  DeadCodeOverlap,
  DeadCodePhaseTimeoutMs,
  LintPhaseTimeoutMs,
  ScanDeadlineMs,
  SupplyChainOverlapTimeoutMs,
} from "../src/refs.js";
import { Config } from "../src/services/config.js";
import { DeadCode } from "../src/services/dead-code.js";
import { Files } from "../src/services/files.js";
import { Git } from "../src/services/git.js";
import { LintPartialFailures, Linter } from "../src/services/linter.js";
import { Progress, ProgressCapture } from "../src/services/progress.js";
import { Project } from "../src/services/project.js";
import { Reporter, ReporterCapture } from "../src/services/reporter.js";
import { Score } from "../src/services/score.js";
import { SupplyChain } from "../src/services/supply-chain.js";

const temporaryDirectories: string[] = [];
afterAll(() => {
  for (const directory of temporaryDirectories) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

const sampleProject: ProjectInfo = {
  rootDirectory: "/repo",
  projectName: "sample-app",
  reactVersion: "19.0.0",
  reactMajorVersion: 19,
  tailwindVersion: null,
  zodVersion: null,
  zodMajorVersion: null,
  framework: "vite",
  hasTypeScript: true,
  hasReactCompiler: false,
  hasTanStackQuery: false,
  nextjsVersion: null,
  nextjsMajorVersion: null,
  hasReactNativeWorkspace: false,
  expoVersion: null,
  shopifyFlashListVersion: null,
  shopifyFlashListMajorVersion: null,
  hasReanimated: false,
  isPreES2023Target: false,
  preactVersion: null,
  preactMajorVersion: null,
  sourceFileCount: 1,
};

const lintDiagnostic: Diagnostic = {
  filePath: "/repo/src/App.tsx",
  plugin: "react-doctor",
  rule: "no-derived-state",
  severity: "error",
  message: "Avoid useState(propX)",
  help: "Use propX directly",
  line: 1,
  column: 1,
  category: "Correctness",
};

const deadCodeDiagnostic: Diagnostic = {
  filePath: "src/Unused.tsx",
  plugin: "deslop",
  rule: "unused-file",
  severity: "warning",
  message: "Unused file",
  help: "Delete it.",
  line: 0,
  column: 0,
  category: "Maintainability",
};

const baseInput: InspectInput = {
  directory: "/repo",
  includePaths: [],
  customRulesOnly: false,
  respectInlineDisables: true,
  adoptExistingLintConfig: true,
  ignoredTags: new Set<string>(),
  runDeadCode: true,
  warnings: true,
  isCi: false,
};

const supplyChainDiagnostic: Diagnostic = {
  filePath: "package.json",
  plugin: "socket",
  rule: "low-supply-chain-score",
  severity: "error",
  message: "`event-stream` has a Socket supply-chain score of 25/100.",
  help: "Review it on Socket.",
  line: 8,
  column: 5,
  category: "Security",
};

const layersOf = (config: {
  diagnostics?: ReadonlyArray<Diagnostic>;
  deadCode?: ReadonlyArray<Diagnostic>;
  supplyChain?: ReadonlyArray<Diagnostic>;
  githubViewerPermission?: string | null;
  // Pins the dead-code/lint overlap mode. Defaults to "off" so emit-order
  // assertions stay deterministic regardless of the test box's free memory
  // (the "auto" gate reads `os.freemem()`); overlap tests opt into "on".
  deadCodeOverlap?: "auto" | "on" | "off";
}) =>
  Layer.mergeAll(
    Project.layerOf(sampleProject),
    Config.layerOf({ config: null, resolvedDirectory: "/repo", configSourceDirectory: null }),
    Files.layerInMemory(new Map()),
    Linter.layerOf(config.diagnostics ?? []),
    LintPartialFailures.layerLive,
    DeadCode.layerOf(config.deadCode ?? []),
    Git.layerOf({
      headSha: "abc123",
      githubRepo: "millionco/sample-app",
      defaultBranch: "main",
      githubViewerPermission: config.githubViewerPermission,
    }),
    Score.layerOf({ score: 85, label: "Good" }),
    SupplyChain.layerOf(config.supplyChain ?? []),
    Progress.layerNoop,
    Reporter.layerCapture,
    Layer.succeed(DeadCodeOverlap, config.deadCodeOverlap ?? "off"),
  );

describe("runInspect — phase timeouts & overall deadline", () => {
  // A never-completing analyzer stream stands in for a wedged phase (a
  // pathological file / hung socket); the Effect-level caps must fire.
  const baseTimeoutLayers = (overrides: {
    linter: Layer.Layer<Linter>;
    deadCode: Layer.Layer<DeadCode>;
    refOverrides: Layer.Layer<never>;
  }) =>
    Layer.mergeAll(
      Project.layerOf(sampleProject),
      Config.layerOf({ config: null, resolvedDirectory: "/repo", configSourceDirectory: null }),
      Files.layerInMemory(new Map()),
      overrides.linter,
      LintPartialFailures.layerLive,
      overrides.deadCode,
      Git.layerOf({}),
      Score.layerOf({ score: 85, label: "Good" }),
      SupplyChain.layerOf([]),
      Progress.layerNoop,
      Reporter.layerNoop,
      overrides.refOverrides,
    );

  it("caps the dead-code phase into didDeadCodeFail without sinking the rest of the scan", async () => {
    const output = await Effect.runPromise(
      runInspect(baseInput).pipe(
        Effect.provide(
          baseTimeoutLayers({
            linter: Linter.layerOf([lintDiagnostic]),
            deadCode: Layer.mock(DeadCode, { run: () => Stream.never }),
            refOverrides: Layer.succeed(DeadCodePhaseTimeoutMs, 30),
          }),
        ),
      ),
    );

    expect(output.didDeadCodeFail).toBe(true);
    expect(output.deadCodeFailureReason).toContain("Dead-code analysis exceeded");
    expect(output.deadCodeFailureReason).toContain("skipped");
    // The scan still completed: lint diagnostics came through, score computed.
    expect(output.didLintFail).toBe(false);
    expect(output.diagnostics.map((diagnostic) => diagnostic.rule)).toContain("no-derived-state");
  });

  it("caps the lint phase, nulls the score, and tags the failure as OxlintBatchExceeded", async () => {
    const output = await Effect.runPromise(
      runInspect(baseInput).pipe(
        Effect.provide(
          baseTimeoutLayers({
            linter: Layer.mock(Linter, { run: () => Stream.never }),
            deadCode: DeadCode.layerOf([deadCodeDiagnostic]),
            refOverrides: Layer.succeed(LintPhaseTimeoutMs, 30),
          }),
        ),
      ),
    );

    expect(output.didLintFail).toBe(true);
    expect(output.lintFailureReasonTag).toBe("OxlintBatchExceeded");
    expect(output.lintFailureReason).toContain("Lint analysis exceeded");
    expect(output.score).toBeNull();
    expect(output.diagnostics).toHaveLength(0);
  });

  it("raises ScanDeadlineExceeded when the overall scan deadline elapses", async () => {
    const error = await Effect.runPromise(
      runInspect(baseInput).pipe(
        Effect.provide(
          baseTimeoutLayers({
            linter: Layer.mock(Linter, { run: () => Stream.never }),
            deadCode: DeadCode.layerOf([]),
            // Keep the lint phase cap high so the overall deadline wins the race.
            refOverrides: Layer.mergeAll(
              Layer.succeed(LintPhaseTimeoutMs, 600_000),
              Layer.succeed(ScanDeadlineMs, 30),
            ),
          }),
        ),
        Effect.flip,
      ),
    );

    expect(error.reason._tag).toBe("ScanDeadlineExceeded");
  });
});

// Builds the orchestration stack with a CUSTOM supply-chain layer (a mock that
// hangs, delays, or counts calls) plus an overridable overlap budget — the
// fork/timeout/join path needs both, which the array-only `SupplyChain.layerOf`
// shape behind `layersOf` can't express.
const overlapLayersOf = (config: {
  supplyChain: Layer.Layer<SupplyChain>;
  overlapTimeoutMs: number;
  linter?: Layer.Layer<Linter>;
  diagnostics?: ReadonlyArray<Diagnostic>;
  deadCode?: ReadonlyArray<Diagnostic>;
}) =>
  Layer.mergeAll(
    Project.layerOf(sampleProject),
    Config.layerOf({ config: null, resolvedDirectory: "/repo", configSourceDirectory: null }),
    Files.layerInMemory(new Map()),
    config.linter ?? Linter.layerOf(config.diagnostics ?? []),
    LintPartialFailures.layerLive,
    DeadCode.layerOf(config.deadCode ?? []),
    Git.layerOf({}),
    Score.layerOf({ score: 85, label: "Good" }),
    config.supplyChain,
    Progress.layerNoop,
    Reporter.layerNoop,
    Layer.succeed(SupplyChainOverlapTimeoutMs, config.overlapTimeoutMs),
  );

describe("runInspect — happy path", () => {
  it("collects diagnostics from Linter, DeadCode, and emits them through Reporter", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const output = yield* runInspect(baseInput);
        const ref = yield* ReporterCapture;
        const captured = yield* Ref.get(ref);
        return { output, captured };
      }).pipe(
        Effect.provide(layersOf({ diagnostics: [lintDiagnostic], deadCode: [deadCodeDiagnostic] })),
      ),
    );

    expect(result.output.diagnostics).toHaveLength(2);
    expect(result.output.diagnostics.map((d) => d.rule)).toEqual([
      "no-derived-state",
      "unused-file",
    ]);
    expect(result.output.didLintFail).toBe(false);
    expect(result.output.didDeadCodeFail).toBe(false);
    expect(result.output.score).toEqual({ score: 85, label: "Good" });
    expect(result.output.project.projectName).toBe("sample-app");
    expect(result.output.scoreMetadata).toEqual({
      repo: "millionco/sample-app",
      sha: "abc123",
      framework: "vite",
      reactVersion: "19.0.0",
      sourceFileCount: 1,
      defaultBranch: "main",
    });
    expect(result.output.userConfig).toBeNull();
    expect(result.output.resolvedDirectory).toBe("/repo");
    expect(result.output.lintPartialFailures).toEqual([]);
    expect(result.captured).toHaveLength(2);
    expect(result.captured.map((d) => d.rule)).toEqual(["no-derived-state", "unused-file"]);
  });

  it("returns empty diagnostics when no service emits", async () => {
    const output = await Effect.runPromise(
      runInspect(baseInput).pipe(Effect.provide(layersOf({}))),
    );
    expect(output.diagnostics).toEqual([]);
    expect(output.didLintFail).toBe(false);
    expect(output.didDeadCodeFail).toBe(false);
  });

  it("adds local authenticated GitHub viewer permission to score metadata", async () => {
    const output = await Effect.runPromise(
      runInspect({ ...baseInput, resolveLocalGithubViewerPermission: true }).pipe(
        Effect.provide(layersOf({ githubViewerPermission: "maintain" })),
      ),
    );

    expect(output.scoreMetadata).toMatchObject({
      repo: "millionco/sample-app",
      githubViewerPermission: "maintain",
    });
  });

  it("does not query local GitHub viewer permission in CI", async () => {
    const output = await Effect.runPromise(
      runInspect({
        ...baseInput,
        isCi: true,
        resolveLocalGithubViewerPermission: true,
      }).pipe(Effect.provide(layersOf({ githubViewerPermission: "maintain" }))),
    );

    expect(output.scoreMetadata).not.toHaveProperty("githubViewerPermission");
  });

  it("falls back when local GitHub viewer permission cannot resolve", async () => {
    const failingGit = Layer.mock(Git, {
      githubRepo: () => Effect.succeed("millionco/sample-app"),
      headSha: () => Effect.succeed("abc123"),
      defaultBranch: () => Effect.succeed("main"),
      githubViewerPermission: () =>
        Effect.fail(
          new ReactDoctorError({
            reason: new GitInvocationFailed({
              args: ["api", "graphql"],
              directory: "/repo",
              cause: new Error("gh unavailable"),
            }),
          }),
        ),
    });
    const layers = Layer.mergeAll(
      Project.layerOf(sampleProject),
      Config.layerOf({ config: null, resolvedDirectory: "/repo", configSourceDirectory: null }),
      Files.layerInMemory(new Map()),
      Linter.layerOf([]),
      LintPartialFailures.layerLive,
      DeadCode.layerOf([]),
      failingGit,
      Score.layerOf({ score: 85, label: "Good" }),
      SupplyChain.layerOf([]),
      Progress.layerNoop,
      Reporter.layerCapture,
    );

    const output = await Effect.runPromise(
      runInspect({ ...baseInput, resolveLocalGithubViewerPermission: true }).pipe(
        Effect.provide(layers),
      ),
    );

    expect(output.scoreMetadata).toMatchObject({
      repo: "millionco/sample-app",
      sha: "abc123",
      defaultBranch: "main",
    });
    expect(output.scoreMetadata).not.toHaveProperty("githubViewerPermission");
  });
});

describe("runInspect — deterministic diagnostic ordering", () => {
  const diagnosticZ: Diagnostic = {
    filePath: "/repo/src/Zzz.tsx",
    plugin: "react-doctor",
    rule: "no-derived-state",
    severity: "error",
    message: "Diagnostic Z",
    help: "Fix Z",
    line: 1,
    column: 1,
    category: "Correctness",
  };

  const diagnosticA: Diagnostic = {
    filePath: "/repo/src/Aaa.tsx",
    plugin: "react-doctor",
    rule: "no-derived-state",
    severity: "error",
    message: "Diagnostic A",
    help: "Fix A",
    line: 1,
    column: 1,
    category: "Correctness",
  };

  it("returns diagnostics in canonical order regardless of arrival order", async () => {
    const output = await Effect.runPromise(
      runInspect(baseInput).pipe(
        Effect.provide(layersOf({ diagnostics: [diagnosticZ, diagnosticA], deadCode: [] })),
      ),
    );

    expect(output.diagnostics.map((diagnostic) => diagnostic.filePath)).toEqual([
      "/repo/src/Aaa.tsx",
      "/repo/src/Zzz.tsx",
    ]);
  });

  it("produces an identical score and diagnostic set across arrival orders", async () => {
    const reverseOrder = await Effect.runPromise(
      runInspect(baseInput).pipe(
        Effect.provide(layersOf({ diagnostics: [diagnosticZ, diagnosticA], deadCode: [] })),
      ),
    );
    const forwardOrder = await Effect.runPromise(
      runInspect(baseInput).pipe(
        Effect.provide(layersOf({ diagnostics: [diagnosticA, diagnosticZ], deadCode: [] })),
      ),
    );

    expect(reverseOrder.score).toEqual(forwardOrder.score);
    expect(reverseOrder.diagnostics).toEqual(forwardOrder.diagnostics);
  });
});

describe("runInspect — missing React dependency", () => {
  it("fails with a tagged NoReactDependency reason", async () => {
    const projectWithoutReact: ProjectInfo = { ...sampleProject, reactVersion: null };
    const layers = Layer.mergeAll(
      Project.layerOf(projectWithoutReact),
      Config.layerOf({ config: null, resolvedDirectory: "/repo", configSourceDirectory: null }),
      Files.layerInMemory(new Map()),
      Linter.layerOf([]),
      LintPartialFailures.layerLive,
      DeadCode.layerOf([]),
      Git.layerOf({}),
      Score.layerOf(null),
      SupplyChain.layerOf([]),
      Progress.layerNoop,
      Reporter.layerNoop,
    );

    // Note: runInspect doesn't currently check reactVersion (that check
    // happens in the legacy inspect.ts before calling). For PR 5 the api
    // package adds the boundary check. This test verifies the orchestrator
    // *would* propagate a tagged error if one came from Project.
    const explicitFailLayers = Layer.mergeAll(
      Layer.mock(Project, {
        discover: () =>
          Effect.fail(
            new ReactDoctorError({ reason: new NoReactDependency({ directory: "/repo" }) }),
          ),
      }),
      Config.layerOf({ config: null, resolvedDirectory: "/repo", configSourceDirectory: null }),
      Files.layerInMemory(new Map()),
      Linter.layerOf([]),
      LintPartialFailures.layerLive,
      DeadCode.layerOf([]),
      Git.layerOf({}),
      Score.layerOf(null),
      SupplyChain.layerOf([]),
      Progress.layerNoop,
      Reporter.layerNoop,
    );
    void layers;
    const exit = await Effect.runPromiseExit(
      runInspect(baseInput).pipe(Effect.provide(explicitFailLayers)),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const failures = exit.cause.reasons;
      const failedReason = failures.find((r) => r._tag === "Fail");
      expect(failedReason).toBeDefined();
      if (failedReason && failedReason._tag === "Fail") {
        const error = failedReason.error as ReactDoctorError;
        expect(error._tag).toBe("ReactDoctorError");
        expect(error.reason._tag).toBe("NoReactDependency");
      }
    }
  });
});

describe("runInspect — mid-stream lint failure", () => {
  it("folds a Stream.fail into didLintFail without sinking the scan", async () => {
    const failingLinter = Layer.mock(Linter, {
      run: () =>
        Stream.fail(
          new ReactDoctorError({
            reason: new OxlintSpawnFailed({ cause: "synthetic failure" }),
          }),
        ),
    });
    const layers = Layer.mergeAll(
      Project.layerOf(sampleProject),
      Config.layerOf({ config: null, resolvedDirectory: "/repo", configSourceDirectory: null }),
      Files.layerInMemory(new Map()),
      failingLinter,
      LintPartialFailures.layerLive,
      DeadCode.layerOf([deadCodeDiagnostic]),
      Git.layerOf({}),
      Score.layerOf({ score: 50, label: "Needs Improvement" }),
      SupplyChain.layerOf([]),
      Progress.layerNoop,
      Reporter.layerNoop,
      // Pin the sequential path so this test doesn't fork dead-code on a
      // high-memory box (the "auto" gate reads os.freemem()); the fork+interrupt
      // path is covered by the dedicated overlap test below.
      Layer.succeed(DeadCodeOverlap, "off"),
    );
    const output = await Effect.runPromise(runInspect(baseInput).pipe(Effect.provide(layers)));
    expect(output.didLintFail).toBe(true);
    expect(output.lintFailureReasonTag).toBe("OxlintSpawnFailed");
    expect(output.lintFailureReason).toContain("oxlint");
    expect(output.score).toBeNull();
    expect(output.diagnostics).toHaveLength(0);
  });
});

describe("runInspect — dead-code failure", () => {
  it("folds DeadCode failure without sinking the scan", async () => {
    const failingDeadCode = Layer.mock(DeadCode, {
      run: () =>
        Stream.fail(
          new ReactDoctorError({
            reason: new DeadCodeAnalysisFailed({ cause: "synthetic boom" }),
          }),
        ),
    });
    const layers = Layer.mergeAll(
      Project.layerOf(sampleProject),
      Config.layerOf({ config: null, resolvedDirectory: "/repo", configSourceDirectory: null }),
      Files.layerInMemory(new Map()),
      Linter.layerOf([lintDiagnostic]),
      LintPartialFailures.layerLive,
      failingDeadCode,
      Git.layerOf({}),
      Score.layerOf(null),
      SupplyChain.layerOf([]),
      Progress.layerNoop,
      Reporter.layerNoop,
      // Pin overlap off so the path under test is deterministic regardless of
      // the box's free memory (the "auto" gate reads os.freemem()).
      Layer.succeed(DeadCodeOverlap, "off"),
    );
    const output = await Effect.runPromise(runInspect(baseInput).pipe(Effect.provide(layers)));
    expect(output.didDeadCodeFail).toBe(true);
    expect(output.deadCodeFailureReason).toContain("Dead-code analysis failed");
    expect(output.didLintFail).toBe(false);
    expect(output.diagnostics).toHaveLength(1);
    expect(output.diagnostics[0].rule).toBe("no-derived-state");
  });
});

describe("runInspect — dead-code/lint overlap", () => {
  it("forced on: diagnostics + score identical to sequential, overlap recorded", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const output = yield* runInspect(baseInput);
        const ref = yield* ReporterCapture;
        const captured = yield* Ref.get(ref);
        return { output, captured };
      }).pipe(
        Effect.provide(
          layersOf({
            diagnostics: [lintDiagnostic],
            deadCode: [deadCodeDiagnostic],
            deadCodeOverlap: "on",
          }),
        ),
      ),
    );
    // The final concat order (env, supply-chain, lint, dead-code) is fixed and
    // independent of which fiber finished first — the core overlap invariant.
    expect(result.output.diagnostics.map((diagnostic) => diagnostic.rule)).toEqual([
      "no-derived-state",
      "unused-file",
    ]);
    expect(result.output.deadCodeOverlapped).toBe(true);
    expect(result.output.didDeadCodeFail).toBe(false);
    expect(result.output.score).toEqual({ score: 85, label: "Good" });
    // Emit order MAY interleave under overlap (the forked fiber emits during
    // lint), so assert the captured SET rather than the sequence. Production
    // uses Reporter.layerNoop, so emit order is unobservable there regardless.
    expect(new Set(result.captured.map((diagnostic) => diagnostic.rule))).toEqual(
      new Set(["no-derived-state", "unused-file"]),
    );
  });

  it("forced off: output identical to the overlap-on path, overlap not recorded", async () => {
    const output = await Effect.runPromise(
      runInspect(baseInput).pipe(
        Effect.provide(
          layersOf({
            diagnostics: [lintDiagnostic],
            deadCode: [deadCodeDiagnostic],
            deadCodeOverlap: "off",
          }),
        ),
      ),
    );
    expect(output.diagnostics.map((diagnostic) => diagnostic.rule)).toEqual([
      "no-derived-state",
      "unused-file",
    ]);
    expect(output.deadCodeOverlapped).toBe(false);
    expect(output.didDeadCodeFail).toBe(false);
  });

  it("lint failure with overlap on surfaces no dead-code and a null score (fiber interrupted)", async () => {
    const failingLinter = Layer.mock(Linter, {
      run: () =>
        Stream.fail(
          new ReactDoctorError({
            reason: new OxlintSpawnFailed({ cause: "synthetic failure" }),
          }),
        ),
    });
    const layers = Layer.mergeAll(
      Project.layerOf(sampleProject),
      Config.layerOf({ config: null, resolvedDirectory: "/repo", configSourceDirectory: null }),
      Files.layerInMemory(new Map()),
      failingLinter,
      LintPartialFailures.layerLive,
      DeadCode.layerOf([deadCodeDiagnostic]),
      Git.layerOf({}),
      Score.layerOf({ score: 50, label: "Needs Improvement" }),
      SupplyChain.layerOf([]),
      Progress.layerNoop,
      Reporter.layerNoop,
      Layer.succeed(DeadCodeOverlap, "on"),
    );
    const output = await Effect.runPromise(runInspect(baseInput).pipe(Effect.provide(layers)));
    expect(output.didLintFail).toBe(true);
    expect(output.score).toBeNull();
    // The dead-code fiber was forked then interrupted on lint failure, so its
    // diagnostic is discarded and the lint-failed ⇒ didDeadCodeFail:false
    // contract is preserved even though the layer would have "succeeded".
    expect(output.diagnostics).toHaveLength(0);
    expect(output.didDeadCodeFail).toBe(false);
  });

  it("never takes the gated overlap for a concurrent batch member (shared memory budget)", async () => {
    // The "auto" gate reads this scan's own os.freemem(), blind to sibling
    // scans in a concurrent batch, so a concurrent member must stay sequential
    // regardless of how much memory a CI box reports — otherwise N siblings
    // would each fork an 8 GB worker and sum past the single-scan budget.
    const output = await Effect.runPromise(
      runInspect({ ...baseInput, concurrentScan: true }).pipe(
        Effect.provide(
          layersOf({
            diagnostics: [lintDiagnostic],
            deadCode: [deadCodeDiagnostic],
            deadCodeOverlap: "auto",
          }),
        ),
      ),
    );
    expect(output.deadCodeOverlapped).toBe(false);
    // Output is unchanged — it just ran sequentially.
    expect(output.diagnostics.map((diagnostic) => diagnostic.rule)).toEqual([
      "no-derived-state",
      "unused-file",
    ]);
  });

  it("still overlaps a concurrent batch member when overlap is explicitly forced on", async () => {
    // `"on"` is an operator override ("I own this box"), so it wins over the
    // concurrent-scan auto-gate guard.
    const output = await Effect.runPromise(
      runInspect({ ...baseInput, concurrentScan: true }).pipe(
        Effect.provide(
          layersOf({
            diagnostics: [lintDiagnostic],
            deadCode: [deadCodeDiagnostic],
            deadCodeOverlap: "on",
          }),
        ),
      ),
    );
    expect(output.deadCodeOverlapped).toBe(true);
    expect(output.diagnostics.map((diagnostic) => diagnostic.rule)).toEqual([
      "no-derived-state",
      "unused-file",
    ]);
  });
});

describe("runInspect — hooks fire in order", () => {
  it("calls beforeLint before any diagnostic emission and afterLint after", async () => {
    const events: string[] = [];
    const output = await Effect.runPromise(
      runInspect(baseInput, {
        beforeLint: (project) =>
          Effect.sync(() => {
            events.push(`beforeLint:${project.projectName}`);
          }),
        afterLint: (didFail) =>
          Effect.sync(() => {
            events.push(`afterLint:${didFail}`);
          }),
      }).pipe(Effect.provide(layersOf({ diagnostics: [lintDiagnostic] }))),
    );
    expect(output.diagnostics).toHaveLength(1);
    expect(events).toEqual(["beforeLint:sample-app", "afterLint:false"]);
  });
});

describe("runInspect — scan progress phases", () => {
  it("runs dead-code after lint and labels it as a separate progress phase", async () => {
    const phaseEvents: string[] = [];
    const trackingLinter = Layer.mock(Linter, {
      run: () =>
        Stream.unwrap(
          Effect.sync(() => {
            phaseEvents.push("lint");
            return Stream.fromIterable([lintDiagnostic]);
          }),
        ),
    });
    const trackingDeadCode = Layer.mock(DeadCode, {
      run: () =>
        Stream.unwrap(
          Effect.sync(() => {
            phaseEvents.push("dead-code");
            return Stream.fromIterable([deadCodeDiagnostic]);
          }),
        ),
    });
    const layers = Layer.mergeAll(
      Project.layerOf(sampleProject),
      Config.layerOf({ config: null, resolvedDirectory: "/repo", configSourceDirectory: null }),
      Files.layerInMemory(new Map()),
      trackingLinter,
      LintPartialFailures.layerLive,
      trackingDeadCode,
      Git.layerOf({}),
      Score.layerOf(null),
      SupplyChain.layerOf([]),
      Progress.layerCapture,
      Reporter.layerNoop,
      // This test asserts the strictly-sequential ordering (lint → afterLint →
      // dead-code), so pin overlap off — under overlap the forked dead-code
      // fiber runs during lint and "dead-code" would no longer trail afterLint.
      Layer.succeed(DeadCodeOverlap, "off"),
    );

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const output = yield* runInspect(baseInput, {
          afterLint: () =>
            Effect.sync(() => {
              phaseEvents.push("afterLint");
            }),
        });
        const progressRef = yield* ProgressCapture;
        const progressEvents = yield* Ref.get(progressRef);
        return { output, progressEvents };
      }).pipe(Effect.provide(layers)),
    );

    expect(result.output.diagnostics.map((diagnostic) => diagnostic.rule)).toEqual([
      "no-derived-state",
      "unused-file",
    ]);
    expect(phaseEvents).toEqual(["lint", "afterLint", "dead-code"]);
    const progressTexts = result.progressEvents.map((event) => event.text);
    expect(progressTexts).toContain("Scanning...");
    // The dead-code phase carries the scanned file total so the counter never
    // appears to stall short of N before the handoff (issue #815).
    expect(
      progressTexts.some((text) => /^Scanned \d+ files?, analyzing dead code\.\.\.$/.test(text)),
      `dead-code phase should report the scanned file total, got: ${progressTexts.join(" | ")}`,
    ).toBe(true);
  });
});

describe("runInspect — diff mode skips dead-code", () => {
  it("treats includePaths.length > 0 as diff mode and skips DeadCode.run", async () => {
    const output = await Effect.runPromise(
      runInspect({ ...baseInput, includePaths: ["src/App.tsx"] }).pipe(
        Effect.provide(layersOf({ diagnostics: [lintDiagnostic], deadCode: [deadCodeDiagnostic] })),
      ),
    );
    // Lint diagnostic flows through; dead-code stream is replaced with empty.
    expect(output.diagnostics.map((d) => d.rule)).toEqual(["no-derived-state"]);
    expect(output.didDeadCodeFail).toBe(false);
  });

  it("passes Next middleware and proxy entries through to the linter", async () => {
    const nextProject: ProjectInfo = {
      ...sampleProject,
      framework: "nextjs",
      nextjsVersion: "^16.0.0",
      nextjsMajorVersion: 16,
    };
    const reportingLinter = Layer.mock(Linter, {
      run: (input) =>
        Stream.fromIterable(
          (input.includePaths ?? []).map((relativePath) => ({
            ...lintDiagnostic,
            filePath: `/repo/${relativePath}`,
            rule: "no-debugger",
            message: `Diagnostic emitted from ${relativePath}`,
          })),
        ),
    });
    const layers = Layer.mergeAll(
      Project.layerOf(nextProject),
      Config.layerOf({ config: null, resolvedDirectory: "/repo", configSourceDirectory: null }),
      Files.layerInMemory(new Map()),
      reportingLinter,
      LintPartialFailures.layerLive,
      DeadCode.layerOf([deadCodeDiagnostic]),
      Git.layerOf({}),
      Score.layerOf(null),
      SupplyChain.layerOf([]),
      Progress.layerNoop,
      Reporter.layerCapture,
    );

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const output = yield* runInspect({
          ...baseInput,
          includePaths: ["middleware.ts", "src/proxy.mjs", "src/server.ts", "src/App.tsx"],
        });
        const ref = yield* ReporterCapture;
        const captured = yield* Ref.get(ref);
        return { output, captured };
      }).pipe(Effect.provide(layers)),
    );

    // The returned diagnostics are in canonical (filePath-major) order — the
    // deterministic sort, independent of the linter's arrival order.
    expect(result.output.diagnostics.map((diagnostic) => diagnostic.filePath)).toEqual([
      "/repo/middleware.ts",
      "/repo/src/App.tsx",
      "/repo/src/proxy.mjs",
    ]);
    // The Reporter captures diagnostics as they stream through, before the
    // final sort — so it preserves the linter's arrival (includePaths) order.
    expect(result.captured.map((diagnostic) => diagnostic.filePath)).toEqual([
      "/repo/middleware.ts",
      "/repo/src/proxy.mjs",
      "/repo/src/App.tsx",
    ]);
  });
});

describe("runInspect — runDeadCode=false short-circuits dead-code", () => {
  it("skips DeadCode entirely when runDeadCode: false", async () => {
    const output = await Effect.runPromise(
      runInspect({ ...baseInput, runDeadCode: false }).pipe(
        Effect.provide(layersOf({ diagnostics: [lintDiagnostic], deadCode: [deadCodeDiagnostic] })),
      ),
    );
    expect(output.diagnostics.map((d) => d.rule)).toEqual(["no-derived-state"]);
    expect(output.didDeadCodeFail).toBe(false);
  });
});

describe("runInspect — Reporter sees post-filter diagnostics", () => {
  it("filters out a diagnostic on a file ignored by config, then emits remaining", async () => {
    const ignoredDiagnostic: Diagnostic = {
      ...lintDiagnostic,
      filePath: "src/ignored.test.tsx",
      rule: "no-derived-state",
    };
    const layers = Layer.mergeAll(
      Project.layerOf(sampleProject),
      Config.layerOf({
        config: { ignore: { files: ["src/ignored.*"] } } as never,
        resolvedDirectory: "/repo",
        configSourceDirectory: null,
      }),
      Files.layerInMemory(new Map()),
      Linter.layerOf([ignoredDiagnostic, lintDiagnostic]),
      LintPartialFailures.layerLive,
      DeadCode.layerOf([]),
      Git.layerOf({}),
      Score.layerOf(null),
      SupplyChain.layerOf([]),
      Progress.layerNoop,
      Reporter.layerCapture,
    );
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const output = yield* runInspect(baseInput);
        const ref = yield* ReporterCapture;
        const captured = yield* Ref.get(ref);
        return { output, captured };
      }).pipe(Effect.provide(layers)),
    );
    expect(result.output.diagnostics.map((d) => d.filePath)).toEqual(["/repo/src/App.tsx"]);
    expect(result.captured.map((d) => d.filePath)).toEqual(["/repo/src/App.tsx"]);
  });
});

describe("runInspect — supply-chain in diff mode", () => {
  it("runs supply-chain in full scans", async () => {
    const output = await Effect.runPromise(
      runInspect(baseInput).pipe(
        Effect.provide(layersOf({ supplyChain: [supplyChainDiagnostic] })),
      ),
    );
    expect(output.diagnostics.map((d) => d.rule)).toContain("low-supply-chain-score");
  });

  it("skips supply-chain in a plain diff scan (no manifest change)", async () => {
    const output = await Effect.runPromise(
      runInspect({ ...baseInput, includePaths: ["src/App.tsx"] }).pipe(
        Effect.provide(layersOf({ supplyChain: [supplyChainDiagnostic] })),
      ),
    );
    expect(output.diagnostics.map((d) => d.rule)).not.toContain("low-supply-chain-score");
  });

  it("runs supply-chain in a diff scan when the manifest changed", async () => {
    const output = await Effect.runPromise(
      runInspect({
        ...baseInput,
        includePaths: ["src/App.tsx"],
        supplyChainManifestChanged: true,
      }).pipe(Effect.provide(layersOf({ supplyChain: [supplyChainDiagnostic] }))),
    );
    expect(output.diagnostics.map((d) => d.rule)).toContain("low-supply-chain-score");
  });
});

describe("runInspect — supply-chain lint overlap", () => {
  it("preserves the fixed diagnostic order when the forked check is joined", async () => {
    const output = await Effect.runPromise(
      runInspect(baseInput).pipe(
        Effect.provide(
          layersOf({
            supplyChain: [supplyChainDiagnostic],
            diagnostics: [lintDiagnostic],
            deadCode: [deadCodeDiagnostic],
          }),
        ),
      ),
    );
    // The forked supply-chain diagnostic survives the join and the output is
    // `sortDiagnosticsStable`-ordered by (filePath, line, …) — deterministic
    // regardless of which fiber settled first. filePath order:
    // "/repo/src/App.tsx" (no-derived-state) < "package.json"
    // (low-supply-chain-score) < "src/Unused.tsx" (unused-file).
    expect(output.diagnostics.map((d) => d.rule)).toEqual([
      "no-derived-state",
      "low-supply-chain-score",
      "unused-file",
    ]);
    expect(output.supplyChainOverlapTimedOut).toBe(false);
  });

  it("keeps the score unchanged on the healthy overlap path", async () => {
    const output = await Effect.runPromise(
      runInspect(baseInput).pipe(
        Effect.provide(
          layersOf({
            supplyChain: [supplyChainDiagnostic],
            diagnostics: [lintDiagnostic],
            deadCode: [deadCodeDiagnostic],
          }),
        ),
      ),
    );
    expect(output.score).toEqual({ score: 85, label: "Good" });
    expect(output.didLintFail).toBe(false);
  });

  it("times out a hung supply-chain fiber instead of hanging the scan", async () => {
    const hungSupplyChain = Layer.mock(SupplyChain, {
      run: () => Stream.fromEffect(Effect.never),
    });
    const output = await Effect.runPromise(
      runInspect(baseInput).pipe(
        Effect.provide(
          overlapLayersOf({
            supplyChain: hungSupplyChain,
            overlapTimeoutMs: 50,
            diagnostics: [lintDiagnostic],
          }),
        ),
      ),
    );
    // Without the fork-relative `Effect.timeout`, this scan never resolves.
    expect(output.supplyChainOverlapTimedOut).toBe(true);
    expect(output.diagnostics.map((d) => d.rule)).toEqual(["no-derived-state"]);
    expect(output.didLintFail).toBe(false);
  });

  it("does not cut a slow-but-healthy supply-chain run that finishes within budget", async () => {
    const slowSupplyChain = Layer.mock(SupplyChain, {
      run: () =>
        Stream.fromEffect(Effect.succeed(supplyChainDiagnostic).pipe(Effect.delay("20 millis"))),
    });
    const output = await Effect.runPromise(
      runInspect(baseInput).pipe(
        Effect.provide(
          overlapLayersOf({
            supplyChain: slowSupplyChain,
            overlapTimeoutMs: 5_000,
            diagnostics: [lintDiagnostic],
          }),
        ),
      ),
    );
    expect(output.supplyChainOverlapTimedOut).toBe(false);
    expect(output.diagnostics.map((d) => d.rule)).toContain("low-supply-chain-score");
  });

  it("never invokes supply-chain run in a plain diff scan (fork takes the empty branch)", async () => {
    let supplyChainRunCount = 0;
    const countingSupplyChain = Layer.mock(SupplyChain, {
      run: () => {
        supplyChainRunCount += 1;
        return Stream.fromIterable([supplyChainDiagnostic]);
      },
    });
    const output = await Effect.runPromise(
      runInspect({ ...baseInput, includePaths: ["src/App.tsx"] }).pipe(
        Effect.provide(
          overlapLayersOf({
            supplyChain: countingSupplyChain,
            overlapTimeoutMs: 90_000,
            diagnostics: [lintDiagnostic],
          }),
        ),
      ),
    );
    expect(supplyChainRunCount).toBe(0);
    expect(output.diagnostics.map((d) => d.rule)).not.toContain("low-supply-chain-score");
    expect(output.supplyChainOverlapTimedOut).toBe(false);
  });

  it("invokes supply-chain run once in a diff scan when the manifest changed", async () => {
    let supplyChainRunCount = 0;
    const countingSupplyChain = Layer.mock(SupplyChain, {
      run: () => {
        supplyChainRunCount += 1;
        return Stream.fromIterable([supplyChainDiagnostic]);
      },
    });
    const output = await Effect.runPromise(
      runInspect({
        ...baseInput,
        includePaths: ["src/App.tsx"],
        supplyChainManifestChanged: true,
      }).pipe(
        Effect.provide(
          overlapLayersOf({
            supplyChain: countingSupplyChain,
            overlapTimeoutMs: 90_000,
            diagnostics: [lintDiagnostic],
          }),
        ),
      ),
    );
    expect(supplyChainRunCount).toBe(1);
    expect(output.diagnostics.map((d) => d.rule)).toContain("low-supply-chain-score");
  });

  it("fails open on a supply-chain timeout while a folded lint failure nulls the score", async () => {
    // A lint failure is FOLDED into Stream.empty (not propagated), so the scan
    // still finalizes: the supply-chain fiber self-times-out to [], the score
    // is gated to null by the lint failure, and the timeout flag is recorded.
    const failingLinter = Layer.mock(Linter, {
      run: () =>
        Stream.fail(
          new ReactDoctorError({ reason: new OxlintSpawnFailed({ cause: "synthetic failure" }) }),
        ),
    });
    const hungSupplyChain = Layer.mock(SupplyChain, {
      run: () => Stream.fromEffect(Effect.never),
    });
    const output = await Effect.runPromise(
      runInspect(baseInput).pipe(
        Effect.provide(
          overlapLayersOf({
            supplyChain: hungSupplyChain,
            overlapTimeoutMs: 50,
            linter: failingLinter,
          }),
        ),
      ),
    );
    expect(output.didLintFail).toBe(true);
    expect(output.score).toBeNull();
    expect(output.supplyChainOverlapTimedOut).toBe(true);
    expect(output.diagnostics).toHaveLength(0);
  });

  it("propagates a defect raised after the supply-chain fork without hanging", async () => {
    // Force a defect in the afterLint hook — it fires AFTER the supply-chain
    // fork but BEFORE the join. `forkChild` is structured, so the hung
    // supply-chain child is interrupted with the failing parent rather than
    // left to run out the (deliberately long) budget: the scan fails fast
    // instead of blocking the join on `Effect.never`.
    const hungSupplyChain = Layer.mock(SupplyChain, {
      run: () => Stream.fromEffect(Effect.never),
    });
    const exit = await Effect.runPromiseExit(
      runInspect(baseInput, {
        afterLint: () => Effect.die(new Error("synthetic post-fork defect")),
      }).pipe(
        Effect.provide(
          overlapLayersOf({
            supplyChain: hungSupplyChain,
            overlapTimeoutMs: 600_000,
            diagnostics: [lintDiagnostic],
          }),
        ),
      ),
    );
    expect(Exit.isFailure(exit)).toBe(true);
  });
});

describe("runInspect — security scan rules in the environment-checks phase", () => {
  // Unlike the mocked Linter/DeadCode services, environment checks read
  // the real filesystem at the resolved scan directory, so these tests
  // scan a temp project seeded with a scan-rule finding.
  const makeScanRuleProject = (): string => {
    const rootDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-security-scan-"));
    temporaryDirectories.push(rootDirectory);
    fs.mkdirSync(path.join(rootDirectory, "public"), { recursive: true });
    fs.writeFileSync(
      path.join(rootDirectory, "public", "debug.log"),
      "internal route dump /admin/api session=abc\n",
    );
    return rootDirectory;
  };

  const scanRuleLayersOf = (rootDirectory: string, config: ReactDoctorConfig | null = null) =>
    Layer.mergeAll(
      Project.layerOf({ ...sampleProject, rootDirectory }),
      Config.layerOf({ config, resolvedDirectory: rootDirectory, configSourceDirectory: null }),
      Files.layerInMemory(new Map()),
      Linter.layerOf([]),
      LintPartialFailures.layerLive,
      DeadCode.layerOf([]),
      Git.layerOf({}),
      Score.layerOf(null),
      SupplyChain.layerOf([]),
      Progress.layerNoop,
      Reporter.layerNoop,
    );

  it("emits scan-rule diagnostics in a full scan", async () => {
    const rootDirectory = makeScanRuleProject();
    const output = await Effect.runPromise(
      runInspect({ ...baseInput, directory: rootDirectory }).pipe(
        Effect.provide(scanRuleLayersOf(rootDirectory)),
      ),
    );
    const scanDiagnostics = output.diagnostics.filter((d) => d.rule === "public-debug-artifact");
    expect(scanDiagnostics).toHaveLength(1);
    expect(scanDiagnostics[0]?.severity).toBe("warning");
    expect(scanDiagnostics[0]?.category).toBe("Security");
  });

  it("skips the file scan in diff mode (includePaths.length > 0)", async () => {
    const rootDirectory = makeScanRuleProject();
    const output = await Effect.runPromise(
      runInspect({
        ...baseInput,
        directory: rootDirectory,
        includePaths: ["src/App.tsx"],
      }).pipe(Effect.provide(scanRuleLayersOf(rootDirectory))),
    );
    expect(output.diagnostics.map((d) => d.rule)).not.toContain("public-debug-artifact");
  });

  it("applies user severity overrides to scan-rule diagnostics", async () => {
    const rootDirectory = makeScanRuleProject();
    const output = await Effect.runPromise(
      runInspect({ ...baseInput, directory: rootDirectory }).pipe(
        Effect.provide(
          scanRuleLayersOf(rootDirectory, {
            rules: { "react-doctor/public-debug-artifact": "error" },
          }),
        ),
      ),
    );
    const scanDiagnostics = output.diagnostics.filter((d) => d.rule === "public-debug-artifact");
    expect(scanDiagnostics).toHaveLength(1);
    expect(scanDiagnostics[0]?.severity).toBe("error");
  });
});
