import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import { describe, expect, it } from "vite-plus/test";
import type { Diagnostic, ProjectInfo } from "@react-doctor/core";
import { LintPartialFailures, Linter, type LintInput } from "../../src/services/linter.js";

const sampleProject: ProjectInfo = {
  rootDirectory: "/repo",
  projectName: "x",
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

const sampleDiagnostic: Diagnostic = {
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

const lintInput: LintInput = {
  rootDirectory: "/repo",
  project: sampleProject,
};

describe("Linter.layerOf", () => {
  it("emits the supplied diagnostics as a stream", async () => {
    const collected = await Effect.runPromise(
      Effect.gen(function* () {
        const linter = yield* Linter;
        return yield* Stream.runCollect(linter.run(lintInput));
      }).pipe(
        Effect.provide(
          Layer.mergeAll(Linter.layerOf([sampleDiagnostic]), LintPartialFailures.layerLive),
        ),
      ),
    );
    expect(Array.from(collected)).toEqual([sampleDiagnostic]);
  });

  it("emits empty stream when constructed with []", async () => {
    const collected = await Effect.runPromise(
      Effect.gen(function* () {
        const linter = yield* Linter;
        return yield* Stream.runCollect(linter.run(lintInput));
      }).pipe(Effect.provide(Layer.mergeAll(Linter.layerOf([]), LintPartialFailures.layerLive))),
    );
    expect(Array.from(collected)).toEqual([]);
  });
});

describe("Linter.layerComposite", () => {
  it("concatenates streams from every backend in order", async () => {
    const backendA = Linter.of({
      run: () => Stream.fromIterable([{ ...sampleDiagnostic, rule: "rule-from-a" }]),
    });
    const backendB = Linter.of({
      run: () => Stream.fromIterable([{ ...sampleDiagnostic, rule: "rule-from-b" }]),
    });
    const collected = await Effect.runPromise(
      Effect.gen(function* () {
        const linter = yield* Linter;
        return yield* Stream.runCollect(linter.run(lintInput));
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            Linter.layerComposite([backendA, backendB]),
            LintPartialFailures.layerLive,
          ),
        ),
      ),
    );
    const rules = Array.from(collected).map((diagnostic) => diagnostic.rule);
    expect(rules).toEqual(["rule-from-a", "rule-from-b"]);
  });

  it("emits empty stream when constructed with []", async () => {
    const collected = await Effect.runPromise(
      Effect.gen(function* () {
        const linter = yield* Linter;
        return yield* Stream.runCollect(linter.run(lintInput));
      }).pipe(
        Effect.provide(Layer.mergeAll(Linter.layerComposite([]), LintPartialFailures.layerLive)),
      ),
    );
    expect(Array.from(collected)).toEqual([]);
  });

  it("shares the same LintPartialFailures Ref across all backends", async () => {
    const backendA = Linter.of({
      run: () =>
        Stream.unwrap(
          Effect.gen(function* () {
            const ref = yield* LintPartialFailures;
            yield* Ref.update(ref, (existing) => [...existing, "from-a"]);
            return Stream.empty;
          }),
        ),
    });
    const backendB = Linter.of({
      run: () =>
        Stream.unwrap(
          Effect.gen(function* () {
            const ref = yield* LintPartialFailures;
            yield* Ref.update(ref, (existing) => [...existing, "from-b"]);
            return Stream.empty;
          }),
        ),
    });
    const failures = await Effect.runPromise(
      Effect.gen(function* () {
        const linter = yield* Linter;
        yield* Stream.runCollect(linter.run(lintInput));
        const ref = yield* LintPartialFailures;
        return yield* Ref.get(ref);
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            Linter.layerComposite([backendA, backendB]),
            LintPartialFailures.layerLive,
          ),
        ),
      ),
    );
    expect(failures).toEqual(["from-a", "from-b"]);
  });
});
