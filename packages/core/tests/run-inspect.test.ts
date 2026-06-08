import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import { describe, expect, it } from "vite-plus/test";
import type { Diagnostic, ProjectInfo } from "@react-doctor/core";
import {
  DeadCodeAnalysisFailed,
  GitInvocationFailed,
  NoReactDependency,
  OxlintSpawnFailed,
  ReactDoctorError,
} from "../src/errors.js";
import { runInspect, type InspectInput } from "../src/run-inspect.js";
import { Config } from "../src/services/config.js";
import { DeadCode } from "../src/services/dead-code.js";
import { Files } from "../src/services/files.js";
import { Git } from "../src/services/git.js";
import { LintPartialFailures, Linter } from "../src/services/linter.js";
import { Progress, ProgressCapture } from "../src/services/progress.js";
import { Project } from "../src/services/project.js";
import { Reporter, ReporterCapture } from "../src/services/reporter.js";
import { Score } from "../src/services/score.js";

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

const layersOf = (config: {
  diagnostics?: ReadonlyArray<Diagnostic>;
  deadCode?: ReadonlyArray<Diagnostic>;
  githubViewerPermission?: string | null;
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
    Progress.layerNoop,
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
      Progress.layerNoop,
      Reporter.layerNoop,
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
      Progress.layerNoop,
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
      Progress.layerCapture,
      Reporter.layerNoop,
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
    expect(result.progressEvents.map((event) => event.text)).toContain("Scanning...");
    expect(result.progressEvents.map((event) => event.text)).toContain("Analyzing dead code...");
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

    expect(result.output.diagnostics.map((diagnostic) => diagnostic.filePath)).toEqual([
      "/repo/middleware.ts",
      "/repo/src/proxy.mjs",
      "/repo/src/App.tsx",
    ]);
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
