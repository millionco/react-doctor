import type { ProjectInfo } from "../../types/index.js";
import {
  EARLIEST_GATED_PREACT_MAJOR,
  EARLIEST_GATED_REACT_MAJOR,
  LATEST_KNOWN_PREACT_MAJOR,
  LATEST_KNOWN_REACT_MAJOR,
} from "../../constants.js";
import {
  isMajorMinorAtLeast,
  parseReactMajorMinor,
  parseTailwindMajorMinor,
} from "../../project-info/index.js";

interface MajorLadder {
  name: string;
  majorOf: (project: ProjectInfo) => number | null;
  earliest: number;
  latest: number;
}

interface CapabilityRule {
  // A static token added when `when` holds (or unconditionally if absent).
  token?: string;
  // A token computed from the project (e.g. the bare framework name);
  // a `null` return emits nothing.
  tokenFor?: (project: ProjectInfo) => string | null;
  when?: (project: ProjectInfo) => boolean;
  // A `<name>:<major>` ladder emitted from a detected major version.
  ladder?: MajorLadder;
}

// The single source of truth for which capability tokens a project exposes.
// `buildCapabilities` is a pure projection over `ProjectInfo` (no I/O) — it
// runs in the hot synchronous security-scan path. Add a framework capability
// by adding a row here, not by hardcoding a framework `Set` in a rule.
const FRAMEWORK_CAPABILITIES: CapabilityRule[] = [
  { tokenFor: (project) => project.framework },
  // `react` gates every React-runtime rule family (hooks, JSX, a11y, render
  // performance) so they stay off on a plain TS/JS project. Preact satisfies
  // it too (same hooks + JSX model).
  {
    token: "react",
    when: (project) => project.reactVersion !== null || project.preactVersion !== null,
  },
  // `hasReactNativeWorkspace` / `expoVersion` cover the inverted case the
  // file-level gate can't reach: a web-rooted monorepo whose `apps/mobile`
  // workspace targets React Native / Expo. Without it every `rn-*` / Expo
  // rule is dropped before the package boundary runs.
  {
    token: "react-native",
    when: (project) =>
      project.framework === "expo" ||
      project.framework === "react-native" ||
      project.hasReactNativeWorkspace,
  },
  { token: "expo", when: (project) => project.expoVersion !== null },
  // Derived framework trait: the project ships a first-class server-mutation
  // story tied to a plain `<form action>` (Next.js Server Actions, TanStack
  // server functions, Remix actions). Lets rules ask one question instead of
  // re-listing frameworks (replaces `no-prevent-default`'s hardcoded set). A
  // statically-exported Next.js app is excluded — it has no request-time server.
  {
    token: "server-actions",
    when: (project) =>
      (project.framework === "nextjs" ||
        project.framework === "tanstack-start" ||
        project.framework === "remix") &&
      !project.isStaticExport,
  },
  // `output: "export"` Next.js app — no request-time server, so server-only
  // remediations (server `redirect()`, middleware, Server Actions) don't apply.
  { token: "nextjs:static-export", when: (project) => project.isStaticExport },
  {
    token: "nextjs:15",
    when: (project) => project.nextjsMajorVersion !== null && project.nextjsMajorVersion >= 15,
  },
  {
    ladder: {
      name: "react",
      majorOf: (project) => project.reactMajorVersion,
      earliest: EARLIEST_GATED_REACT_MAJOR,
      latest: LATEST_KNOWN_REACT_MAJOR,
    },
  },
  // `react:19.2` gates `<Activity>` (shipped in 19.2, not 19.0). The
  // `>= 19` guard is load-bearing: `isMajorMinorAtLeast` is optimistic on a
  // null parse, so without it an 18 project with an unparseable spec would
  // wrongly gain the token.
  {
    token: "react:19.2",
    when: (project) =>
      project.reactMajorVersion !== null &&
      project.reactMajorVersion >= 19 &&
      isMajorMinorAtLeast(parseReactMajorMinor(project.reactVersion), { major: 19, minor: 2 }),
  },
  { token: "tailwind", when: (project) => project.tailwindVersion !== null },
  {
    token: "tailwind:3.4",
    when: (project) =>
      project.tailwindVersion !== null &&
      isMajorMinorAtLeast(parseTailwindMajorMinor(project.tailwindVersion), { major: 3, minor: 4 }),
  },
  { token: "zod", when: (project) => project.zodVersion !== null },
  {
    token: "zod:4",
    when: (project) => project.zodMajorVersion !== null && project.zodMajorVersion >= 4,
  },
  { token: "pre-es2023", when: (project) => project.isPreES2023Target },
  { token: "react-compiler", when: (project) => project.hasReactCompiler },
  { token: "tanstack-query", when: (project) => project.hasTanStackQuery },
  { token: "typescript", when: (project) => project.hasTypeScript },
  // Keyed off `preactVersion`, not `framework === "preact"`, so Preact-on-Vite
  // still gets the `preact` bucket.
  { token: "preact", when: (project) => project.preactVersion !== null },
  {
    ladder: {
      name: "preact",
      majorOf: (project) => project.preactMajorVersion,
      earliest: EARLIEST_GATED_PREACT_MAJOR,
      latest: LATEST_KNOWN_PREACT_MAJOR,
    },
  },
  // `pure-preact`: Preact present AND no `react` package, so the project
  // can't be running through `preact/compat` aliasing.
  {
    token: "pure-preact",
    when: (project) => project.preactVersion !== null && project.reactVersion === null,
  },
];

const emitMajorLadder = (
  capabilities: Set<string>,
  ladder: MajorLadder,
  project: ProjectInfo,
): void => {
  const major = ladder.majorOf(project);
  if (major === null) return;
  // Clamp the upper bound: a major parsed from an arbitrary package.json
  // spec can be implausibly large (e.g. a date-like typo `"20240101"`),
  // which would otherwise turn this loop into a multi-minute hang / OOM.
  const cappedMajor = Math.min(major, ladder.latest);
  for (let candidate = ladder.earliest; candidate <= cappedMajor; candidate += 1) {
    capabilities.add(`${ladder.name}:${candidate}`);
  }
};

export const buildCapabilities = (project: ProjectInfo): ReadonlySet<string> => {
  const capabilities = new Set<string>();
  for (const rule of FRAMEWORK_CAPABILITIES) {
    if (rule.ladder) {
      emitMajorLadder(capabilities, rule.ladder, project);
      continue;
    }
    if (rule.tokenFor) {
      const token = rule.tokenFor(project);
      if (token !== null) capabilities.add(token);
      continue;
    }
    if (rule.token && (rule.when?.(project) ?? true)) capabilities.add(rule.token);
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
  // `react-jsx-only` marks rules that apply React-flavoured semantics
  // (component heuristics, React-cased props, synthetic-event naming).
  // They're meaningless — and prone to false positives via PascalCase /
  // hook-name heuristics — on a project without React, so gate them on
  // the `react` capability the same way an explicit `requires` would.
  if (tags?.includes("react-jsx-only") && !capabilities.has("react")) return false;
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
