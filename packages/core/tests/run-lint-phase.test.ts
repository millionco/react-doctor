import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import { describe, expect, it } from "vite-plus/test";
import { OxlintSpawnFailed, OxlintUnavailable, ReactDoctorError } from "../src/errors.js";
import { OxlintConcurrency } from "../src/refs.js";
import { type LintFailureState, runLintPhase } from "../src/run-lint-phase.js";
import { type LintInput, LintPartialFailures, Linter } from "../src/services/linter.js";
import type { ProgressHandle } from "../src/services/progress.js";
import { Reporter } from "../src/services/reporter.js";
import type { Diagnostic, ProjectInfo } from "../src/types/index.js";

const ROOT_DIRECTORY = "/repo";
const AMBIENT_CONCURRENCY = 9;
const OVERLAP_CONCURRENCY = 3;
const SHORT_TIMEOUT_MS = 20;
const LONG_TIMEOUT_MS = 60_000;
const NODE_VERSION = "v22.1.0";

const project = {
  rootDirectory: ROOT_DIRECTORY,
  projectName: "sample-app",
  reactVersion: "19.0.0",
  reactMajorVersion: 19,
  tailwindVersion: null,
  zodVersion: null,
  zodMajorVersion: null,
  framework: "vite",
  hasTypeScript: true,
  hasReactCompiler: false,
  hasI18nLibrary: false,
  tanstackQueryVersion: null,
  mobxVersion: null,
  styledComponentsVersion: null,
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
} satisfies ProjectInfo;

const reactDoctorDiagnostic: Diagnostic = {
  filePath: "/repo/src/app.tsx",
  plugin: "react-doctor",
  rule: "rules-of-hooks",
  severity: "error",
  message: "React Doctor hook finding",
  help: "Fix the hook.",
  line: 2,
  column: 3,
  category: "Correctness",
};

const compilerDiagnostic: Diagnostic = {
  ...reactDoctorDiagnostic,
  plugin: "react-hooks-js",
  rule: "hooks",
  message: "Compiler hook finding",
};

const filteredDiagnostic: Diagnostic = {
  ...reactDoctorDiagnostic,
  rule: "filtered-rule",
  message: "Filtered finding",
};

const initialFailure: LintFailureState = {
  didFail: false,
  reason: null,
  reasonTag: null,
  reasonKind: null,
};

const makeProgress = (events: string[]): ProgressHandle => ({
  update: () => Effect.void,
  succeed: () => Effect.void,
  fail: (text) =>
    Effect.sync(() => {
      events.push(`progress:${text}`);
    }),
  stop: () => Effect.void,
});

const makeReporter = (events: string[]): Reporter["Service"] =>
  Reporter.of({
    emit: (diagnostic) =>
      Effect.sync(() => {
        events.push(`reporter:${diagnostic.rule}`);
      }),
    finalize: Effect.void,
  });

describe("runLintPhase", () => {
  it("preserves the LintInput reference while filtering, deduping, emitting, and overriding overlap concurrency", async () => {
    const events: string[] = [];
    let observedConcurrency: number | undefined;
    let receivedInput: LintInput | undefined;
    const lintInput: LintInput = {
      rootDirectory: ROOT_DIRECTORY,
      project,
      includePaths: ["src/app.tsx"],
      onFileProgress: (scannedFileCount, totalFileCount) => {
        events.push(`files:${scannedFileCount}/${totalFileCount}`);
      },
    };
    const ownKeys = Object.keys(lintInput);
    const partialFailuresRef = Effect.runSync(Ref.make<ReadonlyArray<string>>([]));
    const failureRef = Effect.runSync(Ref.make(initialFailure));
    const linterService = Linter.of({
      run: (input) => {
        receivedInput = input;
        input.onFileProgress?.(1, 1);
        return Stream.unwrap(
          Effect.gen(function* () {
            observedConcurrency = yield* OxlintConcurrency;
            const partialFailures = yield* LintPartialFailures;
            yield* Ref.update(partialFailures, (existing) => [
              ...existing,
              "one batch failed softly",
            ]);
            return Stream.fromIterable([
              compilerDiagnostic,
              filteredDiagnostic,
              reactDoctorDiagnostic,
            ]);
          }),
        );
      },
    });

    const result = await Effect.runPromise(
      runLintPhase({
        linterService,
        lintInput,
        failureRef,
        shouldOverrideLintConcurrency: true,
        lintConcurrency: OVERLAP_CONCURRENCY,
        phaseTimeoutMs: LONG_TIMEOUT_MS,
        filterDiagnostics: (stream) =>
          stream.pipe(Stream.filter((diagnostic) => diagnostic.rule !== filteredDiagnostic.rule)),
        reporterService: makeReporter(events),
        afterLint: (didFail) =>
          Effect.sync(() => {
            events.push(`afterLint:${didFail}`);
          }),
        progress: makeProgress(events),
        nodeVersion: NODE_VERSION,
      }).pipe(
        Effect.provideService(LintPartialFailures, partialFailuresRef),
        Effect.provideService(OxlintConcurrency, AMBIENT_CONCURRENCY),
      ),
    );

    expect(receivedInput).toBe(lintInput);
    expect(Object.keys(lintInput)).toEqual(ownKeys);
    expect(observedConcurrency).toBe(OVERLAP_CONCURRENCY);
    expect(await Effect.runPromise(Ref.get(partialFailuresRef))).toEqual([
      "one batch failed softly",
    ]);
    expect(result).toEqual({
      diagnostics: [reactDoctorDiagnostic],
      failure: initialFailure,
    });
    expect(result.failure).toBe(initialFailure);
    expect(events).toEqual(["files:1/1", "reporter:rules-of-hooks", "afterLint:false"]);
  });

  it("retains ambient concurrency when overlap is disabled", async () => {
    let observedConcurrency: number | undefined;
    const partialFailuresRef = Effect.runSync(Ref.make<ReadonlyArray<string>>([]));
    const failureRef = Effect.runSync(Ref.make(initialFailure));

    await Effect.runPromise(
      runLintPhase({
        linterService: Linter.of({
          run: () =>
            Stream.fromEffect(
              Effect.map(OxlintConcurrency, (concurrency) => {
                observedConcurrency = concurrency;
                return reactDoctorDiagnostic;
              }),
            ),
        }),
        lintInput: { rootDirectory: ROOT_DIRECTORY, project },
        failureRef,
        shouldOverrideLintConcurrency: false,
        lintConcurrency: OVERLAP_CONCURRENCY,
        phaseTimeoutMs: LONG_TIMEOUT_MS,
        filterDiagnostics: (stream) => stream,
        reporterService: makeReporter([]),
        afterLint: () => Effect.void,
        progress: makeProgress([]),
        nodeVersion: NODE_VERSION,
      }).pipe(
        Effect.provideService(LintPartialFailures, partialFailuresRef),
        Effect.provideService(OxlintConcurrency, AMBIENT_CONCURRENCY),
      ),
    );

    expect(observedConcurrency).toBe(AMBIENT_CONCURRENCY);
  });

  it("folds a mid-stream native-binding failure after emitting prior diagnostics", async () => {
    const events: string[] = [];
    const partialFailuresRef = Effect.runSync(Ref.make<ReadonlyArray<string>>([]));
    const failureRef = Effect.runSync(Ref.make(initialFailure));
    const error = new ReactDoctorError({
      reason: new OxlintUnavailable({
        kind: "native-binding-missing",
        detail: "unsupported ABI",
      }),
    });

    const result = await Effect.runPromise(
      runLintPhase({
        linterService: Linter.of({
          run: () => Stream.concat(Stream.make(reactDoctorDiagnostic), Stream.fail(error)),
        }),
        lintInput: { rootDirectory: ROOT_DIRECTORY, project },
        failureRef,
        shouldOverrideLintConcurrency: false,
        lintConcurrency: OVERLAP_CONCURRENCY,
        phaseTimeoutMs: LONG_TIMEOUT_MS,
        filterDiagnostics: (stream) => stream,
        reporterService: makeReporter(events),
        afterLint: (didFail) =>
          Effect.sync(() => {
            events.push(`afterLint:${didFail}`);
          }),
        progress: makeProgress(events),
        nodeVersion: NODE_VERSION,
      }).pipe(Effect.provideService(LintPartialFailures, partialFailuresRef)),
    );

    expect(result.diagnostics).toEqual([reactDoctorDiagnostic]);
    expect(result.failure).toEqual({
      didFail: true,
      reason: error.message,
      reasonTag: "OxlintUnavailable",
      reasonKind: "native-binding-missing",
    });
    expect(events).toEqual([
      "reporter:rules-of-hooks",
      "afterLint:true",
      `progress:Scanning failed — oxlint native binding not found (Node ${NODE_VERSION}).`,
    ]);
  });

  it("folds timeout into the established failure state before hook and progress reporting", async () => {
    const events: string[] = [];
    const partialFailuresRef = Effect.runSync(Ref.make<ReadonlyArray<string>>([]));
    const failureRef = Effect.runSync(Ref.make(initialFailure));

    const result = await Effect.runPromise(
      runLintPhase({
        linterService: Linter.of({ run: () => Stream.never }),
        lintInput: { rootDirectory: ROOT_DIRECTORY, project },
        failureRef,
        shouldOverrideLintConcurrency: false,
        lintConcurrency: OVERLAP_CONCURRENCY,
        phaseTimeoutMs: SHORT_TIMEOUT_MS,
        filterDiagnostics: (stream) => stream,
        reporterService: makeReporter(events),
        afterLint: (didFail) =>
          Effect.sync(() => {
            events.push(`afterLint:${didFail}`);
          }),
        progress: makeProgress(events),
        nodeVersion: NODE_VERSION,
      }).pipe(Effect.provideService(LintPartialFailures, partialFailuresRef)),
    );

    expect(result).toEqual({
      diagnostics: [],
      failure: {
        didFail: true,
        reason: "Lint analysis exceeded 0.02s and was skipped.",
        reasonTag: "OxlintBatchExceeded",
        reasonKind: null,
      },
    });
    expect(events).toEqual(["afterLint:true", "progress:Scanning failed (lint, non-fatal)."]);
  });

  it("keeps spawn failures on the native-binding progress branch", async () => {
    const events: string[] = [];
    const partialFailuresRef = Effect.runSync(Ref.make<ReadonlyArray<string>>([]));
    const failureRef = Effect.runSync(Ref.make(initialFailure));
    const error = new ReactDoctorError({
      reason: new OxlintSpawnFailed({ cause: "spawn failed" }),
    });

    const result = await Effect.runPromise(
      runLintPhase({
        linterService: Linter.of({ run: () => Stream.fail(error) }),
        lintInput: { rootDirectory: ROOT_DIRECTORY, project },
        failureRef,
        shouldOverrideLintConcurrency: false,
        lintConcurrency: OVERLAP_CONCURRENCY,
        phaseTimeoutMs: LONG_TIMEOUT_MS,
        filterDiagnostics: (stream) => stream,
        reporterService: makeReporter(events),
        afterLint: (didFail) =>
          Effect.sync(() => {
            events.push(`afterLint:${didFail}`);
          }),
        progress: makeProgress(events),
        nodeVersion: NODE_VERSION,
      }).pipe(Effect.provideService(LintPartialFailures, partialFailuresRef)),
    );

    expect(result.failure.reasonTag).toBe("OxlintSpawnFailed");
    expect(result.failure.reasonKind).toBeNull();
    expect(events).toEqual([
      "afterLint:true",
      `progress:Scanning failed — oxlint native binding not found (Node ${NODE_VERSION}).`,
    ]);
  });
});
