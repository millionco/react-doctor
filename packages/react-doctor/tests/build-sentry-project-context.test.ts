import { afterEach, describe, expect, it } from "vite-plus/test";
import {
  buildSentryProjectContext,
  getSentryProjectInfo,
  setSentryProjectInfo,
} from "../src/cli/utils/build-sentry-project-context.js";
import type { ProjectInfo } from "@react-doctor/core";

const projectInfo: ProjectInfo = {
  rootDirectory: "/workspace/app",
  projectName: "my-app",
  reactVersion: "18.3.1",
  reactMajorVersion: 18,
  tailwindVersion: "3.4.0",
  zodVersion: "3.23.0",
  zodMajorVersion: 3,
  framework: "nextjs",
  hasTypeScript: true,
  hasReactCompiler: false,
  hasTanStackQuery: true,
  preactVersion: null,
  preactMajorVersion: null,
  nextjsVersion: null,
  nextjsMajorVersion: null,
  hasReactNativeWorkspace: false,
  expoVersion: null,
  shopifyFlashListVersion: null,
  shopifyFlashListMajorVersion: null,
  hasReanimated: false,
  sourceFileCount: 142,
};

describe("buildSentryProjectContext", () => {
  it("maps detected project info to namespaced, searchable tags", () => {
    const { tags } = buildSentryProjectContext(projectInfo);
    expect(tags).toEqual({
      "project.framework": "nextjs",
      "project.reactMajor": 18,
      "project.typescript": true,
      "project.reactCompiler": false,
      "project.expo": false,
      "project.reactNative": false,
    });
  });

  it("includes the anonymous project shape (no source code) in the context block", () => {
    const { context } = buildSentryProjectContext(projectInfo);
    expect(context).toMatchObject({
      framework: "nextjs",
      reactVersion: "18.3.1",
      reactMajorVersion: 18,
      hasTanStackQuery: true,
      tailwindVersion: "3.4.0",
      sourceFileCount: 142,
    });
  });

  it("omits identifying fields (project name, root directory)", () => {
    const { context } = buildSentryProjectContext(projectInfo);
    expect(context.projectName).toBeUndefined();
    expect(context.rootDirectory).toBeUndefined();
  });

  it("derives the expo tag from expoVersion presence", () => {
    expect(buildSentryProjectContext(projectInfo).tags["project.expo"]).toBe(false);
    expect(
      buildSentryProjectContext({ ...projectInfo, expoVersion: "~51.0.0" }).tags["project.expo"],
    ).toBe(true);
  });

  it("carries a null React major through for projects without React detected", () => {
    const { tags, context } = buildSentryProjectContext({
      ...projectInfo,
      reactVersion: null,
      reactMajorVersion: null,
    });
    expect(tags["project.reactMajor"]).toBeNull();
    expect(context.reactMajorVersion).toBeNull();
  });
});

describe("current project info store", () => {
  afterEach(() => setSentryProjectInfo(null));

  it("remembers and clears the current run's project", () => {
    expect(getSentryProjectInfo()).toBeNull();
    setSentryProjectInfo(projectInfo);
    expect(getSentryProjectInfo()).toBe(projectInfo);
    setSentryProjectInfo(null);
    expect(getSentryProjectInfo()).toBeNull();
  });
});
