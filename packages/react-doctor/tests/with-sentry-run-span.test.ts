import { afterEach, describe, expect, it } from "vite-plus/test";
import {
  recordSentryProjectContext,
  resetSentryRunState,
  withSentryRunSpan,
} from "../src/cli/utils/with-sentry-run-span.js";
import { getActiveRunTrace, setActiveRunTrace } from "../src/cli/utils/active-run-trace.js";
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
  nextjsVersion: null,
  nextjsMajorVersion: null,
  hasReactNativeWorkspace: false,
  expoVersion: null,
  shopifyFlashListVersion: null,
  shopifyFlashListMajorVersion: null,
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

describe("resetSentryRunState", () => {
  afterEach(() => {
    setSentryProjectInfo(null);
    setActiveRunTrace(null);
  });

  it("clears a prior run's project and trace so they can't leak across inspect() runs", () => {
    setSentryProjectInfo(projectInfo);
    setActiveRunTrace({ traceId: "trace-1", spanId: "span-1", sampled: true });

    resetSentryRunState();

    expect(getSentryProjectInfo()).toBeNull();
    expect(getActiveRunTrace()).toBeNull();
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
