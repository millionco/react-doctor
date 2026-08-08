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
    const firstBackend = Linter.of({
      run: () => Stream.fromIterable([{ ...sampleDiagnostic, rule: "rule-from-first" }]),
    });
    const secondBackend = Linter.of({
      run: () => Stream.fromIterable([{ ...sampleDiagnostic, rule: "rule-from-second" }]),
    });
    const collected = await Effect.runPromise(
      Effect.gen(function* () {
        const linter = yield* Linter;
        return yield* Stream.runCollect(linter.run(lintInput));
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            Linter.layerComposite([firstBackend, secondBackend]),
            LintPartialFailures.layerLive,
          ),
        ),
      ),
    );
    expect(Array.from(collected).map((diagnostic) => diagnostic.rule)).toEqual([
      "rule-from-first",
      "rule-from-second",
    ]);
  });

  it("emits an empty stream without backends", async () => {
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

  it("shares partial failures across backends", async () => {
    const createBackend = (failure: string): Linter["Service"] =>
      Linter.of({
        run: () =>
          Stream.unwrap(
            Effect.gen(function* () {
              const partialFailures = yield* LintPartialFailures;
              yield* Ref.update(partialFailures, (existing) => [...existing, failure]);
              return Stream.empty;
            }),
          ),
      });
    const failures = await Effect.runPromise(
      Effect.gen(function* () {
        const linter = yield* Linter;
        yield* Stream.runCollect(linter.run(lintInput));
        const partialFailures = yield* LintPartialFailures;
        return yield* Ref.get(partialFailures);
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            Linter.layerComposite([createBackend("first"), createBackend("second")]),
            LintPartialFailures.layerLive,
          ),
        ),
      ),
    );
    expect(failures).toEqual(["first", "second"]);
  });
});
