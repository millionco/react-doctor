// The capability vocabulary: every token a project can expose, in one
// typed union. @react-doctor/core's `buildCapabilities` (a pure projection
// over its ProjectInfo) is the only emitter; rules consume tokens at config
// time via `Rule.requires` / `Rule.disabledWhen` and at runtime via
// `hasCapability`. Typing both ends against this union makes a misspelled
// token a compile error instead of a silently never-matching gate.
//
// Mirrors core's `Framework` union — core aliases its `Framework` type to
// `FrameworkToken` (core depends on this package, never the reverse), so
// the two cannot drift.
export const FRAMEWORK_TOKENS = [
  "nextjs",
  "vite",
  "cra",
  "remix",
  "gatsby",
  "expo",
  "react-native",
  "tanstack-start",
  "preact",
  "unknown",
] as const;

export type FrameworkToken = (typeof FRAMEWORK_TOKENS)[number];

export type Capability =
  // The bare framework name, including "unknown" — `buildCapabilities`
  // emits `project.framework` unconditionally (the token feeds the
  // ruleset cache key, so even "unknown" is load-bearing).
  | FrameworkToken
  | "react"
  | "pure-preact"
  | "react-native"
  | "server-actions"
  | "client-only"
  | "nextjs:static-export"
  | "nextjs:15"
  | "tailwind"
  | "tailwind:3.4"
  | "zod"
  | "zod:4"
  | "typescript"
  | "react-compiler"
  | "tanstack-query"
  | "pre-es2023"
  // Major-version ladders (`react:17`…) plus minor-versioned gates like
  // `react:19.2` — both parse as numeric template members. Bounds live in
  // core's constants (`EARLIEST_GATED_*` / `LATEST_KNOWN_*`).
  | `react:${number}`
  | `preact:${number}`;

// The shape rules use to query the project's capability set — implemented
// by core (over the memoized set) and by `hasCapability` (over the
// serialized settings bag) so rule content can be capability-parameterized
// in either host.
export type CapabilityQuery = (capability: Capability) => boolean;
