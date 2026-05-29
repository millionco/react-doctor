import type { ProjectInfo } from "../../types/index.js";
import {
  isReactAtLeast,
  isTailwindAtLeast,
  parseReactMajorMinor,
  parseTailwindMajorMinor,
} from "../../project-info/index.js";

// Upper bound for the per-major capability ladder. The major is parsed from
// an untrusted package.json version spec, so clamp it — a spec like
// `"^99999999"` would otherwise spin the loop millions of times.
const MAX_RUNTIME_MAJOR = 100;

const addRuntimeMajorLadder = (
  capabilities: Set<string>,
  runtime: string,
  floorMajor: number,
  detectedMajor: number,
): void => {
  const ceilingMajor = Math.min(detectedMajor, MAX_RUNTIME_MAJOR);
  for (let major = floorMajor; major <= ceilingMajor; major++) {
    capabilities.add(`${runtime}:${major}`);
  }
};

export const buildCapabilities = (project: ProjectInfo): ReadonlySet<string> => {
  const capabilities = new Set<string>();

  capabilities.add(project.framework);
  if (
    project.framework === "expo" ||
    project.framework === "react-native" ||
    project.hasReactNativeWorkspace
  ) {
    // `hasReactNativeWorkspace` covers the inverted case the
    // file-level gate alone cannot reach: a web-rooted monorepo
    // (`next` / `vite` at the entry point) whose `apps/mobile`
    // workspace targets React Native. Without this, every `rn-*`
    // rule is dropped before the file-level package boundary in
    // `oxlint-plugin-react-doctor` ever runs.
    capabilities.add("react-native");
  }

  const reactMajor = project.reactMajorVersion;
  if (reactMajor !== null) {
    addRuntimeMajorLadder(capabilities, "react", 17, reactMajor);
    // Minor-version-pinned capabilities for APIs introduced after a
    // major release. Mirrors the `tailwind:3.4` pattern below.
    // `react:19.2` is the gate for `<Activity>`, which shipped in
    // React 19.2 (the major landed at 19.0 without it). Only consider
    // the minor gate when we've already detected React 19+ — and use
    // `isReactAtLeast`'s optimistic-on-null policy so projects with
    // unparseable specs (workspace protocols, dist-tags) still get
    // the rule when React 19 is otherwise detected.
    if (reactMajor >= 19) {
      const parsedReact = parseReactMajorMinor(project.reactVersion);
      if (isReactAtLeast(parsedReact, { major: 19, minor: 2 })) {
        capabilities.add("react:19.2");
      }
    }
  }

  if (project.tailwindVersion !== null) {
    capabilities.add("tailwind");
    const tailwind = parseTailwindMajorMinor(project.tailwindVersion);
    // HACK: when version is unparseable (dist-tag, workspace protocol),
    // assume latest so version-gated rules still fire.
    if (isTailwindAtLeast(tailwind, { major: 3, minor: 4 })) {
      capabilities.add("tailwind:3.4");
    }
  }

  if (project.hasReactCompiler) capabilities.add("react-compiler");
  if (project.hasTanStackQuery) capabilities.add("tanstack-query");
  if (project.hasTypeScript) capabilities.add("typescript");
  // Keyed off `preactVersion`, not `framework === "preact"`, so the
  // dominant Preact-on-Vite setup (which classifies as `vite` for
  // build-tool reasons) still gets the `preact` capability and its
  // matching rule bucket.
  if (project.preactVersion !== null) {
    capabilities.add("preact");
    // Mirror the React major ladder: a Preact 11 project satisfies rules
    // requiring `preact:10` or `preact:11`. Preact X (10) is the modern
    // baseline react-doctor targets.
    if (project.preactMajorVersion !== null) {
      addRuntimeMajorLadder(capabilities, "preact", 10, project.preactMajorVersion);
    }
    // `pure-preact` is the strict-mode signal: Preact is in the
    // dependency graph AND no `react` package is present, so the
    // project cannot be running through `preact/compat` aliasing.
    // Rules that flag patterns which are silently broken in pure
    // Preact but *correct* under `preact/compat` (e.g. importing
    // hooks from `react`, since `react` is the alias entry point)
    // gate on this stricter capability to avoid false positives in
    // compat-aliased codebases.
    if (project.reactVersion === null) capabilities.add("pure-preact");
  }

  return capabilities;
};

export const shouldEnableRule = (
  requires: ReadonlyArray<string> | undefined,
  tags: ReadonlyArray<string> | undefined,
  capabilities: ReadonlySet<string>,
  ignoredTags: ReadonlySet<string>,
  disabledBy?: ReadonlyArray<string>,
): boolean => {
  if (requires) {
    for (const capability of requires) {
      if (!capabilities.has(capability)) return false;
    }
  }
  if (disabledBy) {
    for (const capability of disabledBy) {
      if (capabilities.has(capability)) return false;
    }
  }
  if (tags) {
    for (const tag of tags) {
      if (ignoredTags.has(tag)) return false;
    }
  }
  return true;
};
