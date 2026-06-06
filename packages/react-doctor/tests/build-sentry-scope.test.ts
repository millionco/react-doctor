import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { buildSentryScope } from "../src/cli/utils/build-sentry-scope.js";
import { setSentryProjectInfo } from "../src/cli/utils/build-sentry-project-context.js";
import type { RunContext } from "../src/cli/utils/build-run-context.js";
import type { ProjectInfo } from "@react-doctor/core";

const baseRunContext: RunContext = {
  version: "1.2.3",
  runId: "run-abc123",
  origin: "ci",
  command: "inspect",
  argv: "--json",
  cwd: "/workspace/project",
  node: "v22.0.0",
  nodeMajor: 22,
  platform: "darwin",
  arch: "arm64",
  ci: true,
  ciProvider: "github-actions",
  eventName: "pull_request",
  viaAction: true,
  codingAgent: null,
  interactive: false,
  jsonMode: true,
  invokedVia: "pnpm",
};

const projectInfo: ProjectInfo = {
  rootDirectory: "/workspace/project",
  projectName: "my-app",
  reactVersion: "18.3.1",
  reactMajorVersion: 18,
  tailwindVersion: "3.4.0",
  zodVersion: null,
  zodMajorVersion: null,
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

describe("buildSentryScope", () => {
  // The current-project store is module-level; keep tests isolated.
  beforeEach(() => setSentryProjectInfo(null));
  afterEach(() => setSentryProjectInfo(null));

  it("maps the run context to searchable tags", () => {
    const { tags } = buildSentryScope(baseRunContext);
    expect(tags).toEqual({
      origin: "ci",
      command: "inspect",
      ci: true,
      ciProvider: "github-actions",
      eventName: "pull_request",
      viaAction: true,
      codingAgent: null,
      interactive: false,
      jsonMode: true,
      invokedVia: "pnpm",
      nodeMajor: 22,
    });
  });

  it("carries runId in the run context but never as a tag", () => {
    const { tags, contexts } = buildSentryScope(baseRunContext);
    // The id rides events/spans without becoming a high-cardinality tag/metric
    // dimension.
    expect((contexts.run as RunContext).runId).toBe("run-abc123");
    expect(tags.runId).toBeUndefined();
  });

  it("attaches the full run context as the `run` context block", () => {
    const { contexts } = buildSentryScope(baseRunContext);
    expect(contexts.run).toEqual(baseRunContext);
  });

  it("omits the project context when no scan has discovered a project yet", () => {
    const { contexts, tags } = buildSentryScope(baseRunContext);
    expect(contexts.project).toBeUndefined();
    expect(tags["project.framework"]).toBeUndefined();
  });

  it("preserves null tags for absent CI/agent signals so they aren't misindexed", () => {
    const { tags } = buildSentryScope({
      ...baseRunContext,
      ci: false,
      ciProvider: null,
      codingAgent: null,
    });
    expect(tags.ciProvider).toBeNull();
    expect(tags.codingAgent).toBeNull();
    expect(tags.ci).toBe(false);
  });

  it("folds the discovered project into tags and the `project` context block", () => {
    setSentryProjectInfo(projectInfo);
    const { tags, contexts } = buildSentryScope(baseRunContext);
    expect(tags["project.framework"]).toBe("nextjs");
    expect(tags["project.reactMajor"]).toBe(18);
    expect(tags["project.typescript"]).toBe(true);
    expect(contexts.project).toMatchObject({
      framework: "nextjs",
      sourceFileCount: 142,
    });
    // The identifying project name is not sent.
    expect(contexts.project?.projectName).toBeUndefined();
    // Run context is still present alongside the project context.
    expect(contexts.run).toEqual(baseRunContext);
  });
});
