import { runCfgCases } from "./run-cfg.js";

// Full port of oxc's `eslint/no-unreachable` corpus
// (`crates/oxc_linter/src/rules/eslint/no_unreachable.rs`, the `pass` /
// `fail` vecs). oxc asserts these through its rule; here we assert the
// underlying CFG fact directly via `isUnreachable`. Each upstream case is
// rewritten so the statement oxc cares about becomes a marker call:
//   - `dead()`  — oxc FAIL: the statement is unreachable.
//   - `live()`  — oxc PASS: the statement is reachable.
// The surrounding control flow is preserved verbatim.
//
// Deliberately omitted: cases whose only point is `var` / function-
// declaration HOISTING (e.g. `function foo() { return x; var x; }` passes
// in oxc because the *declaration* hoists). Hoisting is a rule policy, not
// a CFG reachability fact, and is a documented divergence — see the header
// of control-flow-graph.ts.

runCfgCases("cfg-oxc-no-unreachable / fail (statement is unreachable)", [
  {
    name: "code after return",
    code: `function foo() { return x; dead(); }`,
    unreachable: { dead: true },
  },
  {
    name: "code after throw",
    code: `function foo() { throw error; dead(); }`,
    unreachable: { dead: true },
  },
  {
    name: "code after break in loop",
    code: `while (true) { break; dead(); }`,
    unreachable: { dead: true },
  },
  {
    name: "code after continue in loop",
    code: `while (true) { continue; dead(); }`,
    unreachable: { dead: true },
  },
  {
    name: "code after return in a switch case",
    code: `function foo() { switch (foo) { case 1: return; dead(); } }`,
    unreachable: { dead: true },
  },
  {
    name: "code after throw in a switch case",
    code: `function foo() { switch (foo) { case 1: throw e; dead(); } }`,
    unreachable: { dead: true },
  },
  {
    name: "code after break in a switch case inside a loop",
    code: `while (true) { switch (foo) { case 1: break; dead(); } }`,
    unreachable: { dead: true },
  },
  {
    name: "code after continue in a switch case inside a loop",
    code: `while (true) { switch (foo) { case 1: continue; dead(); } }`,
    unreachable: { dead: true },
  },
  {
    name: "code after a top-level throw",
    code: `var x = 1; throw "uh oh"; dead();`,
    unreachable: { dead: true },
  },
  {
    name: "both if branches terminate (return / throw)",
    code: `function foo() { var x = 1; if (x) { return; } else { throw e; } dead(); }`,
    unreachable: { dead: true },
  },
  {
    name: "both if branches terminate, unbraced",
    code: `function foo() { var x = 1; if (x) return; else throw -1; dead(); }`,
    unreachable: { dead: true },
  },
  {
    name: "try returns, empty finally — code after is unreachable",
    code: `function foo() { var x = 1; try { return; } finally {} dead(); }`,
    unreachable: { dead: true },
  },
  {
    name: "finally returns — code after the try is unreachable",
    code: `function foo() { var x = 1; try {} finally { return; } dead(); }`,
    unreachable: { dead: true },
  },
  {
    name: "do-while body returns on first iteration",
    code: `function foo() { var x = 1; do { return; } while (x); dead(); }`,
    unreachable: { dead: true },
  },
  {
    name: "loop body both breaks and continues — trailing code unreachable",
    code: `function foo() { var x = 1; while (x) { if (x) break; else continue; dead(); } }`,
    unreachable: { dead: true },
  },
  {
    name: "infinite for with a continue and no break",
    code: `function foo() { var x = 1; for (;;) { if (x) continue; } dead(); }`,
    unreachable: { dead: true },
  },
  {
    name: "while (true) with empty body",
    code: `function foo() { var x = 1; while (true) {} dead(); }`,
    unreachable: { dead: true },
  },
  {
    name: "do {} while (true)",
    code: `function foo() { var x = 1; do {} while (true); dead(); }`,
    unreachable: { dead: true },
  },
  {
    name: "branches under an early return are unreachable",
    code: `function foo() { return; if (Math.random() > 0.5) { dead(); } }`,
    unreachable: { dead: true },
  },
  {
    name: "code after return inside a nested function (own CFG)",
    code: `function foo() { if (a) { function bar() { return; dead(); } } }`,
    unreachable: { dead: true },
  },
  {
    name: "return after an infinite loop that returns",
    code: `function foo() { while (true) { return ""; } dead(); }`,
    unreachable: { dead: true },
  },
]);

runCfgCases("cfg-oxc-no-unreachable / pass (statement is reachable)", [
  {
    name: "code after an if that only conditionally returns",
    code: `function foo() { var x = 1; if (x) { return; } live(); }`,
    unreachable: { live: false },
  },
  {
    name: "code after an if whose else returns",
    code: `function foo() { var x = 1; if (x) {} else { return; } live(); }`,
    unreachable: { live: false },
  },
  {
    name: "switch with a break path reaches trailing code",
    code: `function foo() { var x = 1; switch (x) { case 0: break; default: return; } live(); }`,
    unreachable: { live: false },
  },
  {
    name: "while loop may not run, trailing code reachable",
    code: `function foo() { var x = 1; while (x) { return; } live(); }`,
    unreachable: { live: false },
  },
  {
    name: "for-in may not iterate, trailing code reachable",
    code: `function foo() { var x = 1; for (x in {}) { return; } live(); }`,
    unreachable: { live: false },
  },
  {
    name: "finally always runs even when try returns",
    code: `function foo() { var x = 1; try { return; } finally { live(); } }`,
    unreachable: { live: false },
  },
  {
    name: "infinite for with a break reaches trailing code",
    code: `function foo() { var x = 1; for (;;) { if (x) break; } live(); }`,
    unreachable: { live: false },
  },
  {
    name: "labeled block break reaches code after the block",
    code: `A: { break A; } live();`,
    unreachable: { live: false },
  },
  {
    name: "switch without default falls through to trailing code",
    code: `function foo() { switch (authType) { case 1: return a(); case 2: return b(); case 3: return c(); } live(); }`,
    unreachable: { live: false },
  },
  {
    name: "code after try/catch/finally is reachable",
    code: `try { a(); } catch (e) { b(); } finally { c(); } live();`,
    unreachable: { live: false },
  },
  {
    name: "code after try/finally is reachable",
    code: `try { a(); } finally { b(); } live();`,
    unreachable: { live: false },
  },
  {
    name: "catch body is reachable when try has an infinite loop",
    code: `try { while (true) { a(); } } catch { live(); }`,
    unreachable: { live: false },
  },
  {
    name: "finally body is reachable when try has an infinite loop",
    code: `try { while (true) { a(); } } finally { live(); }`,
    unreachable: { live: false },
  },
  {
    name: "return after a conditionally-infinite loop is reachable",
    code: `function foo() { if (Math.random() === 0.5) { while (true) { return "hi"; } } live(); }`,
    unreachable: { live: false },
  },
  {
    name: "sequential for loops in an else branch are reachable",
    code: `if (a) { a(); } else { for (let i = 1; i <= 10; i++) { b(); } for (let i = 1; i <= 10; i++) { live(); } }`,
    unreachable: { live: false },
  },
  {
    name: "code after a try whose body throws into a catch",
    code: `try { throw "error"; } catch (err) { b(); } live();`,
    unreachable: { live: false },
  },
]);
