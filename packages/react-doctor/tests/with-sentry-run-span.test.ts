import { afterEach, describe, expect, it } from "vite-plus/test";
import {
  recordSentryProjectContext,
  withSentryRunSpan,
} from "../src/cli/utils/with-sentry-run-span.js";
import {
  getSentryProjectInfo,
  setSentryProjectInfo,
} from "../src/cli/utils/build-sentry-project-context.js";
import type { ProjectInfo } from "@react-doctor/core";

const projectInfo: ProjectInfo = {
  rootDirectory: "/workspace/app",
  projectName: "my-app",
  reactVersion: "19.0.0",
  reactMajorVersion: 19,
  tailwindVersion: null,
  zodVersion: null,
  zodMajorVersion: null,
  framework: "vite",
  hasTypeScript: true,
  hasReactCompiler: true,
  hasTanStackQuery: false,
  preactVersion: null,
  preactMajorVersion: null,
  hasReactNativeWorkspace: false,
  expoVersion: null,
  hasReanimated: false,
  sourceFileCount: 12,
};

describe("recordSentryProjectContext", () => {
  afterEach(() => setSentryProjectInfo(null));

  it("remembers the project for the lazy error-capture path even without a transaction span", () => {
    expect(getSentryProjectInfo()).toBeNull();
    recordSentryProjectContext(projectInfo, undefined);
    expect(getSentryProjectInfo()).toBe(projectInfo);
  });
});

describe("withSentryRunSpan", () => {
  it("runs the callback with no root span when Sentry tracing is disabled (under tests)", async () => {
    let receivedRootSpan: unknown = "unset";
    const result = await withSentryRunSpan((rootSpan) => {
      receivedRootSpan = rootSpan;
      return Promise.resolve("done");
    });
    expect(result).toBe("done");
    expect(receivedRootSpan).toBeUndefined();
  });
});
