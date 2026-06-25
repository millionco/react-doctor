import { runCfgCases } from "./run-cfg.js";

// Curated port of oxc's `eslint/no-unsafe-finally` corpus
// (`crates/oxc_linter/src/rules/eslint/no_unsafe_finally.rs`). oxc flags a
// `return` / `throw` / `break` / `continue` in a `finally` because it
// overrides the abrupt completion of the protected region. The
// CFG-observable consequence is that an abrupt `finally` swallows the
// normal continuation: code after the `try` becomes unreachable (the join
// after `finally` is fed only by the now-orphaned post-abrupt block). We
// assert that directly with `isUnreachable`, paired with the safe twin.

runCfgCases("cfg-oxc-no-unsafe-finally / abrupt finally swallows completion (oxc FAIL)", [
  {
    name: "return in finally makes code after the try unreachable",
    code: `function f() { try { a(); } finally { return; } after(); }`,
    unreachable: { after: true },
  },
  {
    name: "throw in finally makes code after the try unreachable",
    code: `function f() { try { a(); } finally { throw e; } after(); }`,
    unreachable: { after: true },
  },
  {
    name: "break in a finally inside a loop swallows the loop continuation",
    code: `while (cond) { try { a(); } finally { break; } afterTry(); }`,
    unreachable: { afterTry: true },
  },
]);

runCfgCases("cfg-oxc-no-unsafe-finally / safe finally (oxc PASS)", [
  {
    name: "plain finally lets code after the try run",
    code: `function f() { try { a(); } finally { cleanup(); } after(); }`,
    unreachable: { after: false },
  },
  {
    name: "return in try (not finally) still lets a sibling path continue",
    code: `function f() { try { risky(); } catch (e) { recover(); } after(); }`,
    unreachable: { after: false },
  },
]);
