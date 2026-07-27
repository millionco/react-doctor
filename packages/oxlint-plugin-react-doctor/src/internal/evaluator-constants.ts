import { REACT_ROUTER_RULE_IDS } from "../plugin/constants/react-router.js";

export const NO_CROSS_FILE_RULE_IDS: ReadonlySet<string> = new Set();

export const VIRTUAL_PROJECT_CROSS_FILE_RULE_IDS: ReadonlySet<string> = new Set([
  ...REACT_ROUTER_RULE_IDS,
  "exhaustive-deps",
  "nextjs-async-dynamic-api-not-awaited",
  "nextjs-missing-metadata",
  "nextjs-no-img-element",
  "nextjs-no-use-search-params-without-suspense",
  "no-adjust-state-on-prop-change",
  "no-barrel-import",
  "no-create-ref-in-function-component",
  "no-derived-state",
  "no-derived-state-effect",
  "no-dynamic-import-path",
  "no-full-lodash-import",
  "no-hydration-branch-on-browser-global",
  "no-indeterminate-attribute",
  "no-initialize-state",
  "no-match-media-in-state-initializer",
  "no-mutating-reducer-state",
  "no-unguarded-browser-global-at-module-scope",
  "no-unguarded-browser-global-in-render-or-hook-init",
  "rendering-hydration-mismatch-time",
  "rn-no-legacy-shadow-styles",
  "rn-no-raw-text",
  "rn-prefer-expo-image",
  "rn-style-prefer-boxshadow",
  "rules-of-hooks",
  "window-open-without-noopener",
]);
