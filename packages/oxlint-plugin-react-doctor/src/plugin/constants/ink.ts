export const INK_MODULE = "ink";

export const MINIMUM_INK_VERSIONS = {
  base: "3.0.0",
  textLayoutGuard: "3.0.1",
  aria: "6.2.0",
  cursor: "6.7.0",
  concurrent: "6.7.0",
  renderToString: "6.8.0",
  modernHooks: "7.0.0",
  suspendTerminal: "7.1.0",
};

export const INK_RULE_IDS: ReadonlyArray<string> = [
  "ink-ctrl-c-handler-requires-exit-option",
  "ink-newline-inside-text",
  "ink-no-bare-process-exit",
  "ink-no-direct-raw-mode",
  "ink-no-dom-host-elements",
  "ink-no-dom-router",
  "ink-no-focus-in-render",
  "ink-no-layout-inside-text",
  "ink-no-live-hooks-in-render-to-string",
  "ink-no-measure-element-in-render",
  "ink-no-multiple-static",
  "ink-no-raw-text",
  "ink-no-repeated-render",
  "ink-prefer-use-animation",
  "ink-prefer-use-paste",
  "ink-static-is-append-only",
  "ink-static-requires-key",
  "ink-suspense-requires-concurrent",
  "ink-use-reactive-window-size",
  "ink-use-string-width-for-cursor",
  "ink-use-suspend-terminal",
  "ink-valid-aria-semantics",
];
