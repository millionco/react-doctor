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
//   - Project-config readers — these classify the owning package by reading
//     the nearest `package.json`. That input is not folded into the ruleset
//     hash, so they are carved here too. `rn-prefer-expo-image` reads the
//     package-platform classification; `no-dynamic-import-path` and
//     `no-full-lodash-import` read the manifest's `bin` field
//     (`is-inside-node-cli-package.ts`); `prefer-dynamic-import` reads the
//     publishable-library shape (`is-published-library-package.ts`);
//     `no-indeterminate-attribute`, `rendering-hydration-mismatch-time`,
//     `no-locale-format-in-render`, and `no-match-media-in-state-initializer`
//     read the package-platform classification to skip React Native files;
//     `rn-no-legacy-shadow-styles` and `rn-style-prefer-boxshadow` read the
//     manifest's react-native version plus `android/gradle.properties` and
//     static Expo app configs (`is-legacy-arch-react-native-file.ts`) to stay
//     silent on legacy-architecture apps where `boxShadow` is unsupported.
//
// `cross-file-rule-ids.test.ts` reproduces the transitive import-graph
// analysis and fails if a rule reaching a cross-file primitive is missing from
// this set — turning a future silent staleness bug into a failing test. It
// also forces every rule here into the bounded/unbounded classification in
// `cross-file-dependencies.ts`.
export const CROSS_FILE_RULE_IDS: ReadonlySet<string> = new Set([
  "client-passive-event-listeners",
  "exhaustive-deps",
  "no-barrel-import",
  "nextjs-missing-metadata",
  "nextjs-no-use-search-params-without-suspense",
  "no-dynamic-import-path",
  "no-full-lodash-import",
  "no-hydration-branch-on-browser-global",
  "no-indeterminate-attribute",
  "no-locale-format-in-render",
  "no-match-media-in-state-initializer",
  "no-create-ref-in-function-component",
  "no-adjust-state-on-prop-change",
  "no-derived-state",
  "no-derived-state-effect",
  "no-event-handler",
  "no-effect-with-fresh-deps",
  "no-initialize-state",
  "no-mutating-reducer-state",
  "only-export-components",
  "no-unguarded-browser-global-in-render-or-hook-init",
  "prefer-dynamic-import",
  "rendering-hydration-mismatch-time",
  "rerender-memo-with-default-value",
  "rn-no-legacy-shadow-styles",
  "rn-no-raw-text",
  "rn-prefer-expo-image",
  "rn-style-prefer-boxshadow",
]);
