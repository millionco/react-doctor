import { runCfgCases } from "./run-cfg.js";

// "Returns on every path" post-dominance corpus, modeled on oxc's
// `eslint/getter-return` (`crates/oxc_linter/src/rules/eslint/getter_return.rs`)
// and `consistent-return`: a getter must return a value on every path,
// i.e. the implicit fall-through to the function exit must be unreachable.
// The CFG facts:
//   - when every branch returns, a trailing marker is unreachable, and a
//     branch's `return` post-dominates the work before it;
//   - when one branch falls through, the trailing marker is reachable.

runCfgCases("cfg-getter-return / every path returns (oxc PASS for getters)", [
  {
    name: "if/else both return → fall-through is dead",
    code: `function get() { if (x) { return a(); } else { return b(); } end(); }`,
    unreachable: { end: true },
  },
  {
    name: "switch with default all-return → fall-through is dead",
    code: `function get() { switch (x) { case 1: return a(); default: return b(); } end(); }`,
    unreachable: { end: true },
  },
  {
    name: "guard then return: the return post-dominates the guard, the guard dominates the return",
    code: `function get() { guard(); return result(); }`,
    postDominates: [["result", "guard", true]],
    dominates: [["guard", "result", true]],
  },
]);

runCfgCases("cfg-getter-return / a path falls through (oxc FAIL for getters)", [
  {
    name: "if without else falls through",
    code: `function get() { if (cond()) { return a(); } end(); }`,
    unreachable: { end: false },
    // The conditional return does NOT post-dominate the entry work.
    postDominates: [["a", "cond", false]],
  },
  {
    name: "switch missing default falls through",
    code: `function get() { switch (x) { case 1: return a(); } end(); }`,
    unreachable: { end: false },
  },
]);
