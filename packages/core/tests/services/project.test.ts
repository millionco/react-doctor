import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { describe, expect, it } from "vite-plus/test";
import type { ProjectInfo } from "@react-doctor/core";
import { ReactDoctorError } from "../../src/errors.js";
import { Project } from "../../src/services/project.js";

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
  preactVersion: null,
  preactMajorVersion: null,
  sourceFileCount: 1,
};

describe("Project.layerOf", () => {
  it("returns the supplied ProjectInfo regardless of input directory", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const project = yield* Project;
        return yield* project.discover("/anywhere");
      }).pipe(Effect.provide(Project.layerOf(sampleProject))),
    );
    expect(result.projectName).toBe("sample-app");
    expect(result.reactMajorVersion).toBe(19);
  });

  it("never fails with a ReactDoctorError", async () => {
    const exit = await Effect.runPromise(
      Effect.gen(function* () {
        const project = yield* Project;
        return yield* project.discover("/anywhere");
      }).pipe(Effect.provide(Project.layerOf(sampleProject)), Effect.exit),
    );
    expect(Exit.isSuccess(exit)).toBe(true);
  });
});

describe("Project.layerNode", () => {
  it("translates a missing project directory into a tagged ReactDoctorError", async () => {
    const exit = await Effect.runPromise(
      Effect.gen(function* () {
        const project = yield* Project;
        return yield* project.discover("/this/path/should/not/exist/abc-project-info-test-12345");
      }).pipe(Effect.provide(Project.layerNode), Effect.exit),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const failures = exit.cause.reasons.filter(Cause.isFailReason);
      expect(failures.length).toBe(1);
      const error = failures[0].error;
      expect(error).toBeInstanceOf(ReactDoctorError);
      if (error instanceof ReactDoctorError) {
        expect(error.reason._tag).toBe("ProjectNotFound");
      }
    }
  });
});
