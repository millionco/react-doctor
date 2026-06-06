import { describe, expect, it } from "vite-plus/test";
import { isAnalyzableProject } from "../src/project-info/is-analyzable-project.js";
import type { ProjectInfo } from "../src/types/index.js";

const baseProject: ProjectInfo = {
  rootDirectory: "/tmp/app",
  projectName: "app",
  reactVersion: null,
  reactMajorVersion: null,
  tailwindVersion: null,
  zodVersion: null,
  zodMajorVersion: null,
  framework: "unknown",
  hasTypeScript: false,
  hasReactCompiler: false,
  hasTanStackQuery: false,
  preactVersion: null,
  preactMajorVersion: null,
  nextjsVersion: null,
  nextjsMajorVersion: null,
  hasReactNativeWorkspace: false,
  expoVersion: null,
  shopifyFlashListVersion: null,
  shopifyFlashListMajorVersion: null,
  hasReanimated: false,
  sourceFileCount: 0,
};

describe("isAnalyzableProject", () => {
  it("is analyzable when a react version is present", () => {
    expect(isAnalyzableProject({ ...baseProject, reactVersion: "^19.0.0" })).toBe(true);
  });

  it("is analyzable for a Preact project with no react package", () => {
    expect(isAnalyzableProject({ ...baseProject, preactVersion: "^10.22.0" })).toBe(true);
  });

  it("is not analyzable with neither react nor preact", () => {
    expect(isAnalyzableProject(baseProject)).toBe(false);
  });
});
