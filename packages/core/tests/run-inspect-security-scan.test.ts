import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { describe, expect, it, vi } from "vite-plus/test";
import type { Diagnostic, ProjectInfo } from "@react-doctor/core";

// Module-wide mock (why this lives in its own file, away from the main
// run-inspect suite): the forked security scan must reject so the fail-open
// path — not the healthy walk — is what the scan exercises.
vi.mock("../src/check-security-scan.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/check-security-scan.js")>()),
  checkSecurityScanCooperative: () =>
    Promise.reject(new Error("EMFILE: too many open files, open 'src/App.tsx'")),
}));

import { runInspect, type InspectInput } from "../src/run-inspect.js";
import { DeadCodeOverlap } from "../src/refs.js";
import { Config } from "../src/services/config.js";
import { DeadCode } from "../src/services/dead-code.js";
import { Files } from "../src/services/files.js";
import { Git } from "../src/services/git.js";
import { LintPartialFailures, Linter } from "../src/services/linter.js";
import { Progress } from "../src/services/progress.js";
import { Project } from "../src/services/project.js";
import { Reporter } from "../src/services/reporter.js";
import { Score } from "../src/services/score.js";
import { SupplyChain } from "../src/services/supply-chain.js";

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

const layers = Layer.mergeAll(
  Project.layerOf(sampleProject),
  Config.layerOf({ config: null, resolvedDirectory: "/repo", configSourceDirectory: null }),
  Files.layerInMemory(new Map()),
  Linter.layerOf([lintDiagnostic]),
  LintPartialFailures.layerLive,
  DeadCode.layerOf([]),
  Git.layerOf({}),
  Score.layerOf({ score: 85, label: "Good" }),
  SupplyChain.layerOf([]),
  Progress.layerNoop,
  Reporter.layerNoop,
  Layer.succeed(DeadCodeOverlap, "off"),
);

describe("runInspect — security-scan fail-open", () => {
  it("skips a failing security scan instead of sinking the scan, and records it on securityScanFailed", async () => {
    // Before the fail-open, this rejection defected through the unconditional
    // `Fiber.join` and the whole (otherwise successful) scan threw.
    const output = await Effect.runPromise(runInspect(baseInput).pipe(Effect.provide(layers)));

    expect(output.securityScanFailed).toBe(true);
    expect(output.diagnostics.map((diagnostic) => diagnostic.rule)).toEqual(["no-derived-state"]);
    expect(output.didLintFail).toBe(false);
    expect(output.score).toEqual({ score: 85, label: "Good" });
  });
});
