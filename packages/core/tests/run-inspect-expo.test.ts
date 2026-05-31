import path from "node:path";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { describe, expect, it } from "vite-plus/test";
import type { Diagnostic, ProjectInfo } from "@react-doctor/core";
import { runInspect, type InspectInput } from "../src/run-inspect.js";
import { Config } from "../src/services/config.js";
import { DeadCode } from "../src/services/dead-code.js";
import { Files } from "../src/services/files.js";
import { Git } from "../src/services/git.js";
import { LintPartialFailures, Linter } from "../src/services/linter.js";
import { Progress } from "../src/services/progress.js";
import { Project } from "../src/services/project.js";
import { Reporter } from "../src/services/reporter.js";
import { Score } from "../src/services/score.js";

// Regression coverage for the orchestrator wiring of the ported expo-doctor
// checks (PR #583): `run-inspect`'s environment-checks phase must invoke
// `checkExpoProject` so its project-level diagnostics reach `output.diagnostics`,
// and that phase must be skipped in diff mode (these are whole-project findings).
//
// The per-check logic is unit-tested in `check-expo-project.test.ts`, and
// `expoVersion` discovery in `discover-project.test.ts`. This test uses the
// isolated `runInspect` harness (explicit test layers) pointed at a committed
// Expo fixture so the env checks read stable on-disk content — deterministic
// under the concurrent suite, unlike driving the global `inspect()` entry point.

const EXPO_FIXTURE_DIRECTORY = path.join(import.meta.dirname, "fixtures", "expo-doctor-app");

const expoProject = (expoVersion: string | null): ProjectInfo => ({
  rootDirectory: EXPO_FIXTURE_DIRECTORY,
  projectName: "expo-doctor-app",
  reactVersion: "18.2.0",
  reactMajorVersion: 18,
  tailwindVersion: null,
  zodVersion: null,
  zodMajorVersion: null,
  framework: "expo",
  hasTypeScript: false,
  hasReactCompiler: false,
  hasTanStackQuery: false,
  hasReactNativeWorkspace: true,
  expoVersion,
  hasReanimated: false,
  preactVersion: null,
  preactMajorVersion: null,
  sourceFileCount: 1,
});

const layersFor = (project: ProjectInfo) =>
  Layer.mergeAll(
    Project.layerOf(project),
    Config.layerOf({
      config: null,
      resolvedDirectory: project.rootDirectory,
      configSourceDirectory: null,
    }),
    Files.layerInMemory(new Map()),
    Linter.layerOf([]),
    LintPartialFailures.layerLive,
    DeadCode.layerOf([]),
    Git.layerOf({}),
    Score.layerOf(null),
    Progress.layerNoop,
    Reporter.layerNoop,
  );

const baseInput: InspectInput = {
  directory: EXPO_FIXTURE_DIRECTORY,
  includePaths: [],
  customRulesOnly: false,
  respectInlineDisables: true,
  adoptExistingLintConfig: true,
  ignoredTags: new Set<string>(),
  runDeadCode: false,
  isCi: false,
};

const expoRulesOf = (diagnostics: ReadonlyArray<Diagnostic>): string[] =>
  diagnostics.map((diagnostic) => diagnostic.rule).filter((rule) => rule.startsWith("expo-"));

describe("runInspect — expo project checks wiring", () => {
  it("surfaces checkExpoProject diagnostics through the environment-checks phase", async () => {
    const output = await Effect.runPromise(
      runInspect(baseInput).pipe(Effect.provide(layersFor(expoProject("~54.0.0")))),
    );

    const expoRules = expoRulesOf(output.diagnostics);
    expect(expoRules).toContain("expo-no-cli-dependencies");
    expect(expoRules).toContain("expo-no-redundant-dependency");
  });

  it("skips the expo checks in diff mode (includePaths set)", async () => {
    const output = await Effect.runPromise(
      runInspect({ ...baseInput, includePaths: ["package.json"] }).pipe(
        Effect.provide(layersFor(expoProject("~54.0.0"))),
      ),
    );

    expect(expoRulesOf(output.diagnostics)).toEqual([]);
  });

  it("emits no expo diagnostics when the project is not an Expo project", async () => {
    const output = await Effect.runPromise(
      runInspect(baseInput).pipe(Effect.provide(layersFor(expoProject(null)))),
    );

    expect(expoRulesOf(output.diagnostics)).toEqual([]);
  });
});
