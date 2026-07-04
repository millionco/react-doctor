// Rules whose verdict for a file can depend on the content of OTHER files at
// lint time. The per-file lint cache (`@react-doctor/core`'s `file-lint-cache`)
// keys cached diagnostics on a single file's own content, so it would serve
// STALE results for these rules when a dependency file changes. They are
// therefore run in a separate "sidecar" pass whose caching is guarded by
// per-file dependency fingerprints (`cross-file-dependencies.ts`) rather than
// content alone — a rule here without a dependency collector re-lints every
// file on every scan.
//
// Two flavors live here:
//   - Source-file readers — resolve imports / walk ancestor layouts and read
//     OTHER source files (`no-barrel-import`, the two `nextjs-*` rules,
//     `no-mutating-reducer-state`, and `rn-no-raw-text`, which resolves an
//     imported component to see whether it forwards its children into a
//     `<Text>` or a non-text host).
//   - Project-config readers — `rn-prefer-expo-image` classifies the owning
//     package by reading the nearest `package.json`. That input is not folded
//     into the ruleset hash, so it is carved here too (conservative, and only
//     active on React Native / Expo projects).
//
// `cross-file-rule-ids.test.ts` reproduces the transitive import-graph
// analysis and fails if a rule reaching a cross-file primitive is missing from
// this set — turning a future silent staleness bug into a failing test. It
// also forces every rule here into the bounded/unbounded classification in
// `cross-file-dependencies.ts`.
export const CROSS_FILE_RULE_IDS: ReadonlySet<string> = new Set([
  "no-barrel-import",
  "nextjs-missing-metadata",
  "nextjs-no-use-search-params-without-suspense",
  "no-mutating-reducer-state",
  "rn-no-raw-text",
  "rn-prefer-expo-image",
]);
