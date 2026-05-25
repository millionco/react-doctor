import * as Effect from "effect/Effect";
import { describe, expect, it } from "vite-plus/test";
import type { Diagnostic, ProjectInfo } from "@react-doctor/core";
import { Linter, type LintInput } from "../../src/services/linter.js";

const sampleProject: ProjectInfo = {
  rootDirectory: "/repo",
  projectName: "x",
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
  it("returns the supplied diagnostics as an outcome", async () => {
    const outcome = await Effect.runPromise(
      Effect.gen(function* () {
        const linter = yield* Linter;
        return yield* linter.run(lintInput);
      }).pipe(Effect.provide(Linter.layerOf([sampleDiagnostic]))),
    );
    expect(outcome.diagnostics).toEqual([sampleDiagnostic]);
    expect(outcome.partialFailures).toEqual([]);
  });

  it("returns empty diagnostics when constructed with []", async () => {
    const outcome = await Effect.runPromise(
      Effect.gen(function* () {
        const linter = yield* Linter;
        return yield* linter.run(lintInput);
      }).pipe(Effect.provide(Linter.layerOf([]))),
    );
    expect(outcome.diagnostics).toEqual([]);
    expect(outcome.partialFailures).toEqual([]);
  });
});

describe("Linter.layerComposite", () => {
  it("concatenates outcomes from every backend in order", async () => {
    const backendA = Linter.of({
      run: () =>
        Effect.succeed({
          diagnostics: [{ ...sampleDiagnostic, rule: "rule-from-a" }],
          partialFailures: ["from-a"],
        }),
    });
    const backendB = Linter.of({
      run: () =>
        Effect.succeed({
          diagnostics: [{ ...sampleDiagnostic, rule: "rule-from-b" }],
          partialFailures: ["from-b"],
        }),
    });
    const outcome = await Effect.runPromise(
      Effect.gen(function* () {
        const linter = yield* Linter;
        return yield* linter.run(lintInput);
      }).pipe(Effect.provide(Linter.layerComposite([backendA, backendB]))),
    );
    const rules = outcome.diagnostics.map((diagnostic) => diagnostic.rule);
    expect(rules).toEqual(["rule-from-a", "rule-from-b"]);
    expect(outcome.partialFailures).toEqual(["from-a", "from-b"]);
  });

  it("returns empty outcome when constructed with []", async () => {
    const outcome = await Effect.runPromise(
      Effect.gen(function* () {
        const linter = yield* Linter;
        return yield* linter.run(lintInput);
      }).pipe(Effect.provide(Linter.layerComposite([]))),
    );
    expect(outcome.diagnostics).toEqual([]);
    expect(outcome.partialFailures).toEqual([]);
  });
});
