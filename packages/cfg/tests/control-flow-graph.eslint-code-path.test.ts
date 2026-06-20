import { runCfgCases } from "./run-cfg.js";

// Representative port of ESLint's code-path analysis behavior, as exercised
// by `no-unreachable` and `consistent-return`
// (eslint/lib/linter/code-path-analysis + eslint/tests/lib/rules/
// no-unreachable.js). ESLint walks `CodePathSegment`s marked reachable /
// unreachable; we assert the same segment-reachability facts through
// `isReachable` / `isUnreachable`.

runCfgCases("cfg-eslint-code-path / unreachable segments (no-unreachable)", [
  {
    name: "statement after return is an unreachable segment",
    code: `function foo() { doStuff(); return; deadCode(); }`,
    unreachable: { deadCode: true, doStuff: false },
  },
  {
    name: "statement after an infinite loop is unreachable",
    code: `function foo() { while (true) { work(); } afterLoop(); }`,
    unreachable: { afterLoop: true, work: false },
  },
  {
    name: "both arms terminate → the merge segment is unreachable",
    code: `function foo() { if (a) { throw e; } else { return r(); } merge(); }`,
    unreachable: { merge: true },
  },
  {
    name: "a loop with a reachable break keeps the following segment live",
    code: `function foo() { for (;;) { if (done()) break; } afterLoop(); }`,
    unreachable: { afterLoop: false },
    reachable: [["done", "afterLoop", true]],
  },
]);

runCfgCases("cfg-eslint-code-path / forking & merging (consistent-return)", [
  {
    name: "if-without-else: the post-if segment is reachable from both arms",
    code: `function foo() { if (cond()) { thenWork(); } tail(); }`,
    reachable: [
      ["thenWork", "tail", true],
      ["cond", "tail", true],
    ],
    unreachable: { tail: false },
  },
  {
    name: "early return forks: tail reachable only on the non-returning path",
    code: `function foo() { if (a) { return early(); } tail(); }`,
    reachable: [["early", "tail", false]],
    unreachable: { tail: false },
  },
  {
    name: "try/finally: the finally segment is reached on every path",
    code: `function foo() { try { return body(); } finally { cleanup(); } }`,
    reachable: [["body", "cleanup", true]],
    unreachable: { cleanup: false },
  },
]);
