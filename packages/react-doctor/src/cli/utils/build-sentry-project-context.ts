import type { ProjectInfo } from "@react-doctor/core";

export interface SentryProjectContext {
  // Low-cardinality, searchable signals (framework, React major, capabilities)
  // namespaced under `project.*` so they don't collide with run-context tags.
  readonly tags: Record<string, string | number | boolean | null>;
  // Full project snapshot for the event's "project" context block.
  readonly context: Record<string, unknown>;
}

/**
 * Projects the {@link ProjectInfo} we already detect during a scan into the
 * Sentry scope shape: a handful of searchable `project.*` tags plus the
 * anonymous project *shape* as a `project` context block. Lets crash/transaction
 * triage answer "which kind of project hit this?" (framework, React/Expo
 * version, TypeScript, size) without sending source code — and deliberately
 * omits `projectName` and `rootDirectory`, the two identifying fields, so the
 * project can't be tied back to a specific company/repo.
 */
export const buildSentryProjectContext = (projectInfo: ProjectInfo): SentryProjectContext => ({
  tags: {
    "project.framework": projectInfo.framework,
    "project.reactMajor": projectInfo.reactMajorVersion,
    "project.typescript": projectInfo.hasTypeScript,
    "project.reactCompiler": projectInfo.hasReactCompiler,
    "project.expo": projectInfo.expoVersion !== null,
    "project.reactNative": projectInfo.hasReactNativeWorkspace,
  },
  context: {
    framework: projectInfo.framework,
    reactVersion: projectInfo.reactVersion,
    reactMajorVersion: projectInfo.reactMajorVersion,
    hasTypeScript: projectInfo.hasTypeScript,
    hasReactCompiler: projectInfo.hasReactCompiler,
    hasTanStackQuery: projectInfo.hasTanStackQuery,
    tailwindVersion: projectInfo.tailwindVersion,
    zodVersion: projectInfo.zodVersion,
    preactVersion: projectInfo.preactVersion,
    hasReactNativeWorkspace: projectInfo.hasReactNativeWorkspace,
    expoVersion: projectInfo.expoVersion,
    hasReanimated: projectInfo.hasReanimated,
    sourceFileCount: projectInfo.sourceFileCount,
  },
});

// The project being scanned in the current run, captured as soon as it's
// discovered (the `beforeLint` hook). Held at module scope so the lazy,
// capture-time `buildSentryScope()` can fold it into error events even though
// they're funneled through a generic handler that has no `ProjectInfo` in hand
// — mirroring how the run context is rebuilt lazily at capture time.
let currentProjectInfo: ProjectInfo | null = null;

export const setSentryProjectInfo = (projectInfo: ProjectInfo | null): void => {
  currentProjectInfo = projectInfo;
};

export const getSentryProjectInfo = (): ProjectInfo | null => currentProjectInfo;
