import type { Capability } from "oxlint-plugin-react-doctor";
import type { Framework, ProjectInfo } from "../types/index.js";
import {
  EARLIEST_GATED_MOBX_MAJOR,
  EARLIEST_GATED_PREACT_MAJOR,
  EARLIEST_GATED_REACT_MAJOR,
  EARLIEST_GATED_REMOTION_MAJOR,
  EARLIEST_GATED_VALTIO_MAJOR,
  EARLIEST_GATED_ZUSTAND_MAJOR,
  LATEST_KNOWN_PREACT_MAJOR,
  LATEST_KNOWN_REACT_MAJOR,
  LATEST_KNOWN_REMOTION_MAJOR,
  LATEST_KNOWN_VALTIO_MAJOR,
  LATEST_SUPPORTED_MOBX_MAJOR,
  LATEST_SUPPORTED_ZUSTAND_MAJOR,
} from "../constants.js";
import { isMajorMinorAtLeast, parseReactMajorMinor, parseTailwindMajorMinor } from "./version.js";

// SPA / mobile frameworks with no server-side form handler at all —
// `preventDefault()` on `<form onSubmit>` is the canonical pattern there,
// so "use a server action" advice would be actively misleading. Expressed
// here as the `client-only` trait rather than a hardcoded framework `Set`
// inside a rule, so every rule asks the same one question.
const CLIENT_ONLY_FRAMEWORKS: ReadonlySet<Framework> = new Set([
  "vite",
  "cra",
  "gatsby",
  "react-native",
  "expo",
]);

const SSR_FRAMEWORKS: ReadonlySet<Framework> = new Set([
  "nextjs",
  "remix",
  "gatsby",
  "tanstack-start",
]);

const addMajorLadder = (
  capabilities: Set<Capability>,
  name: "react" | "remotion" | "preact" | "valtio" | "mobx" | "zustand",
  major: number | null,
  earliest: number,
  latest: number,
): void => {
  if (major === null) return;
  // Clamp the upper bound: a major parsed from an arbitrary package.json
  // spec can be implausibly large (e.g. a date-like typo `"20240101"`),
  // which would otherwise turn this loop into a multi-minute hang / OOM.
  const cappedMajor = Math.min(major, latest);
  for (let candidate = earliest; candidate <= cappedMajor; candidate += 1) {
    capabilities.add(`${name}:${candidate}`);
  }
};

// The single source of truth for which capability tokens a project exposes.
// A pure projection over `ProjectInfo` (no I/O) — it runs in the hot
// synchronous security-scan path. Add a framework capability by adding a
// line here (and its token to the plugin's `Capability` union), not by
// hardcoding a framework `Set` in a rule.
export const buildCapabilities = (project: ProjectInfo): ReadonlySet<Capability> => {
  const capabilities = new Set<Capability>();

  capabilities.add(project.framework);
  // `react` gates every React-runtime rule family (hooks, JSX, a11y, render
  // performance) so they stay off on a plain TS/JS project. Preact satisfies
  // it too (same hooks + JSX model).
  if (project.reactVersion !== null || project.preactVersion !== null) {
    capabilities.add("react");
  }
  // `hasReactNativeWorkspace` / `expoVersion` cover the inverted case the
  // file-level gate can't reach: a web-rooted monorepo whose `apps/mobile`
  // workspace targets React Native / Expo. Without it every `rn-*` / Expo
  // rule is dropped before the package boundary runs.
  if (
    project.framework === "expo" ||
    project.framework === "react-native" ||
    project.hasReactNativeWorkspace
  ) {
    capabilities.add("react-native");
  }
  if (project.expoVersion !== null) capabilities.add("expo");
  // Derived framework trait: the project ships a first-class server-mutation
  // story tied to a plain `<form action>` (Next.js Server Actions, TanStack
  // server functions, Remix actions). Lets rules ask one question instead of
  // re-listing frameworks. A statically-exported Next.js app is excluded —
  // it has no request-time server.
  if (
    (project.framework === "nextjs" ||
      project.framework === "tanstack-start" ||
      project.framework === "remix") &&
    !project.isStaticExport
  ) {
    capabilities.add("server-actions");
  }
  if (SSR_FRAMEWORKS.has(project.framework) || project.hasSsrDependency) capabilities.add("ssr");
  if (CLIENT_ONLY_FRAMEWORKS.has(project.framework)) capabilities.add("client-only");
  // `output: "export"` Next.js app — no request-time server, so server-only
  // remediations (server `redirect()`, middleware, Server Actions) don't apply.
  if (project.isStaticExport) capabilities.add("nextjs:static-export");
  if (project.nextjsMajorVersion !== null && project.nextjsMajorVersion >= 15) {
    capabilities.add("nextjs:15");
  }
  addMajorLadder(
    capabilities,
    "react",
    project.reactMajorVersion,
    EARLIEST_GATED_REACT_MAJOR,
    LATEST_KNOWN_REACT_MAJOR,
  );
  // `react:19.2` gates `<Activity>` (shipped in 19.2, not 19.0). The
  // `>= 19` guard is load-bearing: `isMajorMinorAtLeast` is optimistic on a
  // null parse, so without it an 18 project with an unparseable spec would
  // wrongly gain the token.
  if (
    project.reactMajorVersion !== null &&
    project.reactMajorVersion >= 19 &&
    isMajorMinorAtLeast(parseReactMajorMinor(project.reactVersion), { major: 19, minor: 2 })
  ) {
    capabilities.add("react:19.2");
  }
  if (project.tailwindVersion !== null) capabilities.add("tailwind");
  if (
    project.tailwindVersion !== null &&
    isMajorMinorAtLeast(parseTailwindMajorMinor(project.tailwindVersion), { major: 3, minor: 4 })
  ) {
    capabilities.add("tailwind:3.4");
  }
  if (project.zodVersion !== null) capabilities.add("zod");
  if (project.zodMajorVersion !== null && project.zodMajorVersion >= 4) capabilities.add("zod:4");
  if (
    (project.mobxVersion !== undefined && project.mobxVersion !== null) ||
    project.hasMobxReact === true ||
    project.hasMobxReactLite === true ||
    project.hasMobxStateTree === true ||
    project.hasMobxReactObserver === true
  ) {
    capabilities.add("mobx");
  }
  if (project.hasMobxReact === true) capabilities.add("mobx-react");
  if (project.hasMobxReactLite === true) capabilities.add("mobx-react-lite");
  if (project.hasMobxReact === true || project.hasMobxReactLite === true) {
    capabilities.add("mobx-react-binding");
  }
  if (project.hasMobxStateTree === true) capabilities.add("mobx-state-tree");
  if (project.hasMobxReactObserver === true) capabilities.add("mobx-react-observer");
  if (
    project.mobxMajorVersion !== undefined &&
    project.mobxMajorVersion !== null &&
    project.mobxMajorVersion >= EARLIEST_GATED_MOBX_MAJOR &&
    project.mobxMajorVersion <= LATEST_SUPPORTED_MOBX_MAJOR
  ) {
    addMajorLadder(
      capabilities,
      "mobx",
      project.mobxMajorVersion,
      EARLIEST_GATED_MOBX_MAJOR,
      LATEST_SUPPORTED_MOBX_MAJOR,
    );
  }
  if (project.zustandVersion !== undefined && project.zustandVersion !== null) {
    capabilities.add("zustand");
  }
  if (
    project.zustandMajorVersion !== undefined &&
    project.zustandMajorVersion !== null &&
    project.zustandMajorVersion >= EARLIEST_GATED_ZUSTAND_MAJOR &&
    project.zustandMajorVersion <= LATEST_SUPPORTED_ZUSTAND_MAJOR
  ) {
    addMajorLadder(
      capabilities,
      "zustand",
      project.zustandMajorVersion,
      EARLIEST_GATED_ZUSTAND_MAJOR,
      LATEST_SUPPORTED_ZUSTAND_MAJOR,
    );
  }
  if (project.isPreES2023Target) capabilities.add("pre-es2023");
  if (project.hasReactCompiler) capabilities.add("react-compiler");
  if (project.hasTanStackQuery) capabilities.add("tanstack-query");
  if (project.valtioVersion !== null) capabilities.add("valtio");
  addMajorLadder(
    capabilities,
    "valtio",
    project.valtioMajorVersion,
    EARLIEST_GATED_VALTIO_MAJOR,
    LATEST_KNOWN_VALTIO_MAJOR,
  );
  if (project.hasRemotion) {
    capabilities.add("remotion");
    addMajorLadder(
      capabilities,
      "remotion",
      project.remotionMajorVersion ?? null,
      EARLIEST_GATED_REMOTION_MAJOR,
      LATEST_KNOWN_REMOTION_MAJOR,
    );
  }
  if (project.hasTypeScript) capabilities.add("typescript");
  // Keyed off `preactVersion`, not `framework === "preact"`, so Preact-on-Vite
  // still gets the `preact` bucket.
  if (project.preactVersion !== null) capabilities.add("preact");
  addMajorLadder(
    capabilities,
    "preact",
    project.preactMajorVersion,
    EARLIEST_GATED_PREACT_MAJOR,
    LATEST_KNOWN_PREACT_MAJOR,
  );
  // `pure-preact`: Preact present AND no `react` package, so the project
  // can't be running through `preact/compat` aliasing.
  if (project.preactVersion !== null && project.reactVersion === null) {
    capabilities.add("pure-preact");
  }

  return capabilities;
};

// One computation per project: `discoverProject` caches one `ProjectInfo`
// object identity per directory, so the oxlint config, the security scan,
// and the recommendation path all share a single memo entry.
const capabilitiesByProject = new WeakMap<ProjectInfo, ReadonlySet<Capability>>();

export const getCapabilities = (project: ProjectInfo): ReadonlySet<Capability> => {
  const cached = capabilitiesByProject.get(project);
  if (cached !== undefined) return cached;
  const capabilities = buildCapabilities(project);
  capabilitiesByProject.set(project, capabilities);
  return capabilities;
};

export const shouldEnableRule = (
  requires: ReadonlyArray<Capability> | undefined,
  tags: ReadonlyArray<string> | undefined,
  capabilities: ReadonlySet<Capability>,
  ignoredTags: ReadonlySet<string>,
  disabledWhen?: ReadonlyArray<Capability>,
): boolean => {
  if (requires) {
    for (const capability of requires) {
      if (!capabilities.has(capability)) return false;
    }
  }
  // `react-jsx-only` marks rules that apply React-flavoured semantics
  // (component heuristics, React-cased props, synthetic-event naming).
  // They're meaningless — and prone to false positives via PascalCase /
  // hook-name heuristics — on a project without React, so gate them on
  // the `react` capability the same way an explicit `requires` would.
  if (tags?.includes("react-jsx-only") && !capabilities.has("react")) return false;
  if (disabledWhen) {
    for (const capability of disabledWhen) {
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
