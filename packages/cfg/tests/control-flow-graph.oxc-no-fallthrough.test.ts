import { runCfgCases } from "./run-cfg.js";

// Curated port of oxc's `eslint/no-fallthrough` corpus
// (`crates/oxc_linter/src/rules/eslint/no_fallthrough.rs`). oxc flags a
// switch case that falls through into the next; the underlying CFG fact is
// "is the next case's body reachable from this one without an intervening
// break / return / throw / continue?" We assert it directly with
// `isReachable(prevCaseMarker, nextCaseMarker)`:
//   - FAIL upstream (fallthrough)  → reachable === true
//   - PASS upstream (terminated)   → reachable === false

runCfgCases("cfg-oxc-no-fallthrough / fallthrough reachable (oxc FAIL)", [
  {
    name: "case with no break falls into the next case",
    code: `switch (x) { case 1: first(); case 2: second(); }`,
    reachable: [["first", "second", true]],
  },
  {
    name: "fallthrough across an empty middle case",
    code: `switch (x) { case 1: first(); case 2: case 3: third(); }`,
    reachable: [["first", "third", true]],
  },
  {
    name: "default falls through to a later... is order-dependent, so guard the common direction",
    code: `switch (x) { case 1: first(); default: fallback(); }`,
    reachable: [["first", "fallback", true]],
  },
]);

runCfgCases("cfg-oxc-no-fallthrough / terminated, no fallthrough (oxc PASS)", [
  {
    name: "break terminates the case",
    code: `switch (x) { case 1: first(); break; case 2: second(); }`,
    reachable: [["first", "second", false]],
  },
  {
    name: "return terminates the case",
    code: `function f() { switch (x) { case 1: first(); return; case 2: second(); } }`,
    reachable: [["first", "second", false]],
  },
  {
    name: "throw terminates the case",
    code: `switch (x) { case 1: first(); throw e; case 2: second(); }`,
    reachable: [["first", "second", false]],
  },
]);
