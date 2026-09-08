// Package names a file must import before the listed rule can report
// anything; the plugin wrapper skips `create` on files importing none of
// them. Only rules whose every report path resolves a same-file import
// binding of these packages belong here — rules matching globals, element
// names, or components forwarded across files must stay out.

const INK_SOURCES: ReadonlyArray<string> = ["ink"];

const MOTION_SOURCES: ReadonlyArray<string> = [
  "framer-motion",
  "framer-motion/client",
  "framer-motion/m",
  "motion/react",
  "motion/react-client",
  "motion/react-m",
];

const RADIX_DIALOG_SOURCES: ReadonlyArray<string> = [
  "radix-ui",
  "@radix-ui/react-dialog",
  "@radix-ui/react-alert-dialog",
];

const STORE_FACTORY_SOURCES: ReadonlyArray<string> = [
  "zustand",
  "redux",
  "@reduxjs/toolkit",
  "jotai",
  "valtio",
  "mobx",
  "nanostores",
  "@xstate/store",
];

export const RULE_REQUIRED_IMPORTS: Readonly<Record<string, ReadonlyArray<string>>> = {
  "ink-ctrl-c-handler-requires-exit-option": INK_SOURCES,
  "ink-no-bare-process-exit": INK_SOURCES,
  "ink-no-direct-raw-mode": INK_SOURCES,
  "ink-no-dom-host-elements": INK_SOURCES,
  "ink-no-dom-router": INK_SOURCES,
  "ink-no-focus-in-render": INK_SOURCES,
  "ink-no-layout-inside-text": INK_SOURCES,
  "ink-no-live-hooks-in-render-to-string": INK_SOURCES,
  "ink-no-measure-element-in-render": INK_SOURCES,
  "ink-no-multiple-static": INK_SOURCES,
  "ink-no-repeated-render": INK_SOURCES,
  "ink-prefer-use-animation": INK_SOURCES,
  "ink-static-is-append-only": INK_SOURCES,
  "ink-static-requires-key": INK_SOURCES,
  "ink-use-reactive-window-size": INK_SOURCES,
  "ink-use-string-width-for-cursor": INK_SOURCES,
  "ink-use-suspend-terminal": INK_SOURCES,
  "ink-valid-aria-semantics": INK_SOURCES,
  "jotai-derived-atom-returns-fresh-object": ["jotai"],
  "jotai-select-atom-in-render-body": ["jotai"],
  "motion-animate-presence-must-outlive-child": MOTION_SOURCES,
  "motion-animate-presence-requires-key": MOTION_SOURCES,
  "motion-animate-presence-wait-single-child": MOTION_SOURCES,
  "motion-create-in-render": MOTION_SOURCES,
  "motion-drag-axis-constraint-mismatch": MOTION_SOURCES,
  "motion-imperative-animation-in-render": MOTION_SOURCES,
  "motion-keyframe-times-mismatch": MOTION_SOURCES,
  "motion-layout-on-inline-element": MOTION_SOURCES,
  "motion-unstable-layout-id-in-iteration": MOTION_SOURCES,
  "motion-use-transform-range-length": MOTION_SOURCES,
  "motion-value-constructor-in-render": MOTION_SOURCES,
  "motion-value-subscription-in-render": MOTION_SOURCES,
  "no-conflicting-spring-options": MOTION_SOURCES,
  "no-static-motion-config-never": MOTION_SOURCES,
  "use-lazy-motion": MOTION_SOURCES,
  "no-create-store-in-render": STORE_FACTORY_SOURCES,
  "no-full-lodash-import": ["lodash"],
  "no-moment": ["moment"],
  "radix-dialog-content-requires-title": RADIX_DIALOG_SOURCES,
  "radix-tabs-trigger-requires-list": ["radix-ui", "@radix-ui/react-tabs"],
  "react-markdown-unsanitized-raw-html": ["react-markdown"],
  "redux-useselector-inline-derivation": ["react-redux"],
  "redux-useselector-returns-new-collection": ["react-redux"],
};
