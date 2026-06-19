// Rules whose verdict for a file can depend on the content of OTHER files at
// lint time. The per-file lint cache (`@react-doctor/core`'s `file-lint-cache`)
// keys cached diagnostics on a single file's own content, so it would serve
// STALE results for these rules when a dependency file changes. They are
// therefore run in an always-fresh "sidecar" pass that is never cached.
//
// Two flavors live here, both safe to keep always-fresh:
//   - Source-file readers — resolve imports / walk ancestor layouts and read
//     OTHER source files (`no-barrel-import`, the two `nextjs-*` rules,
//     `no-mutating-reducer-state`). These MUST stay uncached.
//   - Project-config readers — `rn-prefer-expo-image` classifies the owning
//     package by reading the nearest `package.json`. That input is not folded
//     into the ruleset hash, so it is carved here too (conservative, and only
//     active on React Native / Expo projects).
//
// `cross-file-rules.test.ts` reproduces the transitive import-graph analysis
// and fails if a rule reaching a cross-file primitive is missing from this set —
// turning a future silent staleness bug into a failing test.
export const CROSS_FILE_RULE_IDS: ReadonlySet<string> = new Set([
  "no-barrel-import",
  "nextjs-missing-metadata",
  "nextjs-no-use-search-params-without-suspense",
  "no-mutating-reducer-state",
  "rn-prefer-expo-image",
]);
