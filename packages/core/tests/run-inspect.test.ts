import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import { describe, expect, it } from "vite-plus/test";
import type { Diagnostic, ProjectInfo } from "@react-doctor/types";
import {
  DeadCodeAnalysisFailed,
  NoReactDependency,
  OxlintSpawnFailed,
  ReactDoctorError,
} from "../src/errors.js";
import { runInspect, type InspectInput } from "../src/run-inspect.js";
import { Config } from "../src/services/config.js";
import { DeadCode } from "../src/services/dead-code.js";
import { Files } from "../src/services/files.js";
import { LintPartialFailures, Linter } from "../src/services/linter.js";
import { Project } from "../src/services/project.js";
import { Reporter, ReporterCapture } from "../src/services/reporter.js";
import { Score } from "../src/services/score.js";

const sampleProject: ProjectInfo = {
  rootDirectory: "/repo",
  projectName: "sample-app",
  reactVersion: "19.0.0",
  reactMajorVersion: 19,
  tailwindVersion: null,
  framework: "vite",
  hasTypeScript: true,
  hasReactCompiler: false,
  hasTanStackQuery: false,
  hasReactNativeWorkspace: false,
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
  category: "Dead Code",
};

const baseInput: InspectInput = {
  directory: "/repo",
  includePaths: [],
  customRulesOnly: false,
  respectInlineDisables: true,
  adoptExistingLintConfig: true,
  ignoredTags: new Set<string>(),
  runDeadCode: true,
  isCi: false,
};

const layersOf = (config: {
  diagnostics?: ReadonlyArray<Diagnostic>;
  deadCode?: ReadonlyArray<Diagnostic>;
}) =>
  Layer.mergeAll(
    Project.layerOf(sampleProject),
    Config.layerOf({ config: null, resolvedDirectory: "/repo" }),
    Files.layerInMemory(new Map()),
    Linter.layerOf(config.diagnostics ?? []),
    LintPartialFailures.layerLive,
    DeadCode.layerOf(config.deadCode ?? []),
    Score.layerOf({ score: 85, label: "Good" }),
    Reporter.layerCapture,
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
});

describe("runInspect — missing React dependency", () => {
  it("fails with a tagged NoReactDependency reason", async () => {
    const projectWithoutReact: ProjectInfo = { ...sampleProject, reactVersion: null };
    const layers = Layer.mergeAll(
      Project.layerOf(projectWithoutReact),
      Config.layerOf({ config: null, resolvedDirectory: "/repo" }),
      Files.layerInMemory(new Map()),
      Linter.layerOf([]),
      LintPartialFailures.layerLive,
      DeadCode.layerOf([]),
      Score.layerOf(null),
      Reporter.layerNoop,
    );

    // Note: runInspect doesn't currently check reactVersion (that check
    // happens in the legacy inspect.ts before calling). For PR 5 the api
    // package adds the boundary check. This test verifies the orchestrator
    // *would* propagate a tagged error if one came from Project.
    const failingProject = Project.layerOf(projectWithoutReact);
    const explicitFailLayers = Layer.mergeAll(
      Layer.succeed(Project, {
        discover: () =>
          Effect.fail(
            new ReactDoctorError({ reason: new NoReactDependency({ directory: "/repo" }) }),
          ),
      }),
      Config.layerOf({ config: null, resolvedDirectory: "/repo" }),
      Files.layerInMemory(new Map()),
      Linter.layerOf([]),
      LintPartialFailures.layerLive,
      DeadCode.layerOf([]),
      Score.layerOf(null),
      Reporter.layerNoop,
    );
    void layers;
    void failingProject;
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
    const failingLinter = Layer.succeed(Linter, {
      run: () =>
        Stream.fail(
          new ReactDoctorError({
            reason: new OxlintSpawnFailed({ cause: "synthetic failure" }),
          }),
        ),
    });
    const layers = Layer.mergeAll(
      Project.layerOf(sampleProject),
      Config.layerOf({ config: null, resolvedDirectory: "/repo" }),
      Files.layerInMemory(new Map()),
      failingLinter,
      LintPartialFailures.layerLive,
      DeadCode.layerOf([deadCodeDiagnostic]),
      Score.layerOf({ score: 50, label: "Needs Improvement" }),
      Reporter.layerNoop,
    );
    const output = await Effect.runPromise(runInspect(baseInput).pipe(Effect.provide(layers)));
    expect(output.didLintFail).toBe(true);
    expect(output.lintFailureReasonTag).toBe("OxlintSpawnFailed");
    expect(output.lintFailureReason).toContain("oxlint");
    expect(output.score).toBeNull();
    // Dead code still ran and surfaced its diagnostic
    expect(output.diagnostics).toHaveLength(1);
    expect(output.diagnostics[0].rule).toBe("unused-file");
  });
});

describe("runInspect — dead-code failure", () => {
  it("folds DeadCode failure without sinking the scan", async () => {
    const failingDeadCode = Layer.succeed(DeadCode, {
      run: () =>
        Stream.fail(
          new ReactDoctorError({
            reason: new DeadCodeAnalysisFailed({ cause: "synthetic boom" }),
          }),
        ),
    });
    const layers = Layer.mergeAll(
      Project.layerOf(sampleProject),
      Config.layerOf({ config: null, resolvedDirectory: "/repo" }),
      Files.layerInMemory(new Map()),
      Linter.layerOf([lintDiagnostic]),
      LintPartialFailures.layerLive,
      failingDeadCode,
      Score.layerOf(null),
      Reporter.layerNoop,
    );
    const output = await Effect.runPromise(runInspect(baseInput).pipe(Effect.provide(layers)));
    expect(output.didDeadCodeFail).toBe(true);
    expect(output.deadCodeFailureReason).toContain("Dead-code analysis failed");
    expect(output.didLintFail).toBe(false);
    expect(output.diagnostics).toHaveLength(1);
    expect(output.diagnostics[0].rule).toBe("no-derived-state");
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
      }),
      Files.layerInMemory(new Map()),
      Linter.layerOf([ignoredDiagnostic, lintDiagnostic]),
      LintPartialFailures.layerLive,
      DeadCode.layerOf([]),
      Score.layerOf(null),
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
