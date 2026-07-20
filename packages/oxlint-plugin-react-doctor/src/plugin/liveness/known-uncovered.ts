// Rules registered in the rule registry that have no liveness fixture yet.
// Every entry needs a reason. This list may only shrink: adding a new rule
// without a positive-control fixture in `liveness-fixtures.ts` fails
// `liveness.test.ts` unless the rule is deliberately listed here.
export const KNOWN_UNCOVERED: Readonly<Record<string, string>> = {
  "no-cascading-set-state":
    "retired rule: synchronous effect setters share a React commit, so setter count does not prove redraw count",
  "nextjs-no-use-search-params-without-suspense":
    "cross-file rule: parses the imported component files from the real filesystem, which the in-memory liveness harness cannot fake",
  "no-barrel-import":
    "resolves the imported barrel module on the real filesystem to count its re-exports, which the in-memory liveness harness cannot fake",
  "rn-animate-layout-property": "retired rule: create() intentionally never reports",
  "rn-prefer-content-inset-adjustment": "retired rule: create() intentionally never reports",
  "ink-newline-inside-text": "retired rule: Ink supports Newline as a standalone text node",
  "ink-suspense-requires-concurrent":
    "retired rule: Ink supports Suspense fallback rendering without concurrent mode",
};
