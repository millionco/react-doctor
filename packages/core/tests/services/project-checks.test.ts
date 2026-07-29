import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { Diagnostic, ProjectInfo } from "../../src/types/index.js";

const checkReducedMotionSpy = vi.hoisted(() => vi.fn());
const checkPnpmHardeningSpy = vi.hoisted(() => vi.fn());
const checkReactServerComponentsAdvisorySpy = vi.hoisted(() => vi.fn());
const checkExpoProjectSpy = vi.hoisted(() => vi.fn());
const checkReactNativeProjectSpy = vi.hoisted(() => vi.fn());

vi.mock("../../src/check-reduced-motion.js", () => ({
  checkReducedMotion: checkReducedMotionSpy,
}));
vi.mock("../../src/check-pnpm-hardening.js", () => ({
  checkPnpmHardening: checkPnpmHardeningSpy,
}));
vi.mock("../../src/check-react-server-components-advisory.js", () => ({
  checkReactServerComponentsAdvisory: checkReactServerComponentsAdvisorySpy,
}));
vi.mock("../../src/check-expo-project.js", () => ({
  checkExpoProject: checkExpoProjectSpy,
}));
vi.mock("../../src/check-react-native-project.js", () => ({
  checkReactNativeProject: checkReactNativeProjectSpy,
}));

import { ProjectChecks } from "../../src/services/project-checks.js";

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

const buildDiagnostic = (rule: string): Diagnostic => ({
  filePath: "package.json",
  plugin: "react-doctor",
  rule,
  severity: "warning",
  message: rule,
  help: rule,
  line: 0,
  column: 0,
  category: "Maintainability",
});

const runProjectChecks = (layer: Layer.Layer<ProjectChecks>) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const projectChecks = yield* ProjectChecks;
      return yield* projectChecks.run({
        rootDirectory: "/repo",
        project: sampleProject,
      });
    }).pipe(Effect.provide(layer)),
  );

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ProjectChecks.layerNode", () => {
  it("runs every synchronous project check in the established diagnostic order", async () => {
    checkReducedMotionSpy.mockReturnValue([buildDiagnostic("reduced-motion")]);
    checkPnpmHardeningSpy.mockReturnValue([buildDiagnostic("pnpm-hardening")]);
    checkReactServerComponentsAdvisorySpy.mockReturnValue([buildDiagnostic("rsc-advisory")]);
    checkExpoProjectSpy.mockReturnValue([buildDiagnostic("expo")]);
    checkReactNativeProjectSpy.mockReturnValue([buildDiagnostic("react-native")]);

    const diagnostics = await runProjectChecks(ProjectChecks.layerNode);

    expect(diagnostics.map((diagnostic) => diagnostic.rule)).toEqual([
      "reduced-motion",
      "pnpm-hardening",
      "rsc-advisory",
      "expo",
      "react-native",
    ]);
    expect(checkReducedMotionSpy).toHaveBeenCalledWith("/repo");
    expect(checkPnpmHardeningSpy).toHaveBeenCalledWith("/repo");
    expect(checkReactServerComponentsAdvisorySpy).toHaveBeenCalledWith("/repo", sampleProject);
    expect(checkExpoProjectSpy).toHaveBeenCalledWith("/repo", sampleProject);
    expect(checkReactNativeProjectSpy).toHaveBeenCalledWith("/repo", sampleProject);
  });
});

describe("ProjectChecks.layerOf", () => {
  it("returns the supplied diagnostics without running Node project checks", async () => {
    const diagnostics = [buildDiagnostic("synthetic-project-check")];
    const result = await runProjectChecks(ProjectChecks.layerOf(diagnostics));

    expect(result).toBe(diagnostics);
    expect(checkReducedMotionSpy).not.toHaveBeenCalled();
    expect(checkPnpmHardeningSpy).not.toHaveBeenCalled();
    expect(checkReactServerComponentsAdvisorySpy).not.toHaveBeenCalled();
    expect(checkExpoProjectSpy).not.toHaveBeenCalled();
    expect(checkReactNativeProjectSpy).not.toHaveBeenCalled();
  });
});
