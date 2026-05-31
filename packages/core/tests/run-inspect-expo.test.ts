import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { afterAll, describe, expect, it } from "vite-plus/test";
import type { Diagnostic, ProjectInfo } from "@react-doctor/core";
import { clearPackageJsonCache } from "@react-doctor/core";
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
// isolated `runInspect` harness (explicit test layers + a real temp manifest
// for the env checks to read) rather than the heavyweight `inspect()` entry
// point, so it stays deterministic under the concurrent suite.

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rd-run-inspect-expo-"));

afterAll(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

let caseCounter = 0;
const setupExpoManifest = (): string => {
  const projectDirectory = path.join(tempRoot, `case-${caseCounter++}`);
  fs.mkdirSync(projectDirectory, { recursive: true });
  fs.writeFileSync(
    path.join(projectDirectory, "package.json"),
    JSON.stringify({
      name: "expo-e2e-app",
      dependencies: {
        react: "18.2.0",
        "react-native": "0.74.0",
        expo: "~54.0.0",
        "eas-cli": "^7.0.0",
        "@types/react-native": "^0.74.0",
      },
    }),
  );
  clearPackageJsonCache();
  return projectDirectory;
};

const expoProject = (rootDirectory: string): ProjectInfo => ({
  rootDirectory,
  projectName: "expo-e2e-app",
  reactVersion: "18.2.0",
  reactMajorVersion: 18,
  tailwindVersion: null,
  zodVersion: null,
  zodMajorVersion: null,
  framework: "expo",
  hasTypeScript: true,
  hasReactCompiler: false,
  hasTanStackQuery: false,
  hasReactNativeWorkspace: true,
  expoVersion: "~54.0.0",
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

const baseInput = (rootDirectory: string): InspectInput => ({
  directory: rootDirectory,
  includePaths: [],
  customRulesOnly: false,
  respectInlineDisables: true,
  adoptExistingLintConfig: true,
  ignoredTags: new Set<string>(),
  runDeadCode: false,
  isCi: false,
});

const expoRulesOf = (diagnostics: ReadonlyArray<Diagnostic>): string[] =>
  diagnostics.map((diagnostic) => diagnostic.rule).filter((rule) => rule.startsWith("expo-"));

describe("runInspect — expo project checks wiring", () => {
  it("surfaces checkExpoProject diagnostics through the environment-checks phase", async () => {
    const projectDirectory = setupExpoManifest();
    const output = await Effect.runPromise(
      runInspect(baseInput(projectDirectory)).pipe(
        Effect.provide(layersFor(expoProject(projectDirectory))),
      ),
    );

    const expoRules = expoRulesOf(output.diagnostics);
    expect(expoRules).toContain("expo-no-cli-dependencies");
    expect(expoRules).toContain("expo-no-redundant-dependency");
  });

  it("skips the expo checks in diff mode (includePaths set)", async () => {
    const projectDirectory = setupExpoManifest();
    const output = await Effect.runPromise(
      runInspect({ ...baseInput(projectDirectory), includePaths: ["package.json"] }).pipe(
        Effect.provide(layersFor(expoProject(projectDirectory))),
      ),
    );

    expect(expoRulesOf(output.diagnostics)).toEqual([]);
  });

  it("emits no expo diagnostics when the project is not an Expo project", async () => {
    const projectDirectory = setupExpoManifest();
    const output = await Effect.runPromise(
      runInspect(baseInput(projectDirectory)).pipe(
        Effect.provide(layersFor({ ...expoProject(projectDirectory), expoVersion: null })),
      ),
    );

    expect(expoRulesOf(output.diagnostics)).toEqual([]);
  });
});
