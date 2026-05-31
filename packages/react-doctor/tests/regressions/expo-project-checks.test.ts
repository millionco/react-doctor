/**
 * End-to-end regression tests for the ported expo-doctor checks (PR #583).
 *
 * The per-check logic is unit-tested in
 * `packages/core/tests/check-expo-project.test.ts` by calling
 * `checkExpoProject` directly. These tests instead drive the *whole*
 * public `inspect()` pipeline — project discovery → `run-inspect`'s
 * environment-checks phase → diagnostic merge → `InspectResult` — so the
 * wiring that the unit tests can't see is locked in:
 *
 *   1. `discoverProject` actually resolves `expoVersion` from a real
 *      on-disk manifest (not a hand-built `ProjectInfo`).
 *   2. `checkExpoProject` is genuinely invoked from the environment-checks
 *      phase and its diagnostics reach `result.diagnostics`.
 *   3. The Expo phase is skipped in diff mode (`includePaths` set), since
 *      these are whole-project findings.
 *   4. A web-rooted project that ALSO declares `expo` (where `next`/`vite`
 *      win framework detection) still gets the Expo checks — the headline
 *      reason detection is keyed off `expoVersion` rather than `framework`.
 *
 * Lint + dead-code + score are all disabled so the run is fast, offline,
 * and exercises only the environment-checks phase.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vite-plus/test";
import { clearConfigCache } from "@react-doctor/core";
import type { Diagnostic, InspectResult } from "@react-doctor/core";
import { inspect } from "../../src/inspect.js";
import { writeFile, writeJson } from "./_helpers.js";

vi.mock("ora", () => ({
  default: () => ({
    text: "",
    start() {
      return this;
    },
    stop() {
      return this;
    },
    succeed: () => {},
    fail: () => {},
  }),
}));

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rd-expo-e2e-"));

afterAll(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

let caseCounter = 0;
const setupProject = (dependencies: Record<string, string>): string => {
  const projectDirectory = path.join(tempRoot, `case-${caseCounter++}`);
  fs.mkdirSync(projectDirectory, { recursive: true });
  writeJson(path.join(projectDirectory, "package.json"), {
    name: "expo-e2e-app",
    dependencies,
  });
  writeFile(path.join(projectDirectory, "src", "App.tsx"), "export const App = () => null;\n");
  return projectDirectory;
};

const expoRulesOf = (result: InspectResult): string[] =>
  result.diagnostics
    .map((diagnostic: Diagnostic) => diagnostic.rule)
    .filter((rule) => rule.startsWith("expo-"));

// Lint/dead-code/score off → no oxlint binding or network needed; only the
// environment-checks phase runs. `suppressRendering` skips the renderer and
// returns the raw merged diagnostics on the result.
const runInspectQuiet = (
  directory: string,
  includePaths: string[] = [],
): Promise<InspectResult> => {
  clearConfigCache();
  return inspect(directory, {
    lint: false,
    deadCode: false,
    noScore: true,
    silent: true,
    suppressRendering: true,
    includePaths,
  });
};

describe("expo-doctor checks — e2e through inspect()", () => {
  it("surfaces Expo project-level diagnostics and resolves expoVersion from the manifest", async () => {
    const projectDirectory = setupProject({
      react: "18.2.0",
      "react-native": "0.74.0",
      expo: "~54.0.0",
      "eas-cli": "^7.0.0",
      "@types/react-native": "^0.74.0",
    });

    const result = await runInspectQuiet(projectDirectory);

    expect(result.project.expoVersion).toBe("~54.0.0");
    const expoRules = expoRulesOf(result);
    expect(expoRules).toContain("expo-no-cli-dependencies");
    expect(expoRules).toContain("expo-no-redundant-dependency");
  });

  it("emits no Expo diagnostics on a plain React (non-Expo) project", async () => {
    const projectDirectory = setupProject({
      react: "^19.0.0",
      "react-dom": "^19.0.0",
      // a package the Expo checks would flag IF the project were Expo
      "@types/react-native": "^0.74.0",
    });

    const result = await runInspectQuiet(projectDirectory);

    expect(result.project.expoVersion).toBeNull();
    expect(expoRulesOf(result)).toEqual([]);
  });

  it("skips the Expo checks in diff mode (includePaths set)", async () => {
    const projectDirectory = setupProject({
      react: "18.2.0",
      "react-native": "0.74.0",
      expo: "~54.0.0",
      "eas-cli": "^7.0.0",
    });

    // Sanity: a full scan does flag it…
    const fullScan = await runInspectQuiet(projectDirectory);
    expect(expoRulesOf(fullScan)).toContain("expo-no-cli-dependencies");

    // …but the diff/staged path skips the whole environment-checks phase.
    const diffScan = await runInspectQuiet(projectDirectory, ["src/App.tsx"]);
    expect(diffScan.project.expoVersion).toBe("~54.0.0");
    expect(expoRulesOf(diffScan)).toEqual([]);
  });

  it("still runs the Expo checks when a web bundler wins framework detection", async () => {
    // `next` makes `detectFramework` classify this as a web project, yet the
    // declared `expo` dependency must still drive the Expo checks. This is
    // the regression the `expoVersion`-keyed detection guards against.
    const projectDirectory = setupProject({
      react: "18.2.0",
      "react-dom": "18.2.0",
      next: "^14.0.0",
      "react-native": "0.74.0",
      expo: "~54.0.0",
      "eas-cli": "^7.0.0",
    });

    const result = await runInspectQuiet(projectDirectory);

    expect(result.project.framework).toBe("nextjs");
    expect(result.project.expoVersion).toBe("~54.0.0");
    expect(expoRulesOf(result)).toContain("expo-no-cli-dependencies");
  });
});
