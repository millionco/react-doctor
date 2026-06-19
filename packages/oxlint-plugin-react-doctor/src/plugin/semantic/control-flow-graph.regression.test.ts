import { runCfgCases } from "../../test-utils/run-cfg.js";

// CFG-only regression catalog mined from the Faire monorepo: control-flow
// bug classes where AST matching is insufficient and the same shape is a bug
// or a false positive depending purely on the paths through it. Every
// should-flag fact is paired with its must-stay-quiet twin, so the
// false-positive boundary is itself a locked regression.

// 1. Conditional hook — the hook is reachable on only some paths, so it is
// NOT unconditional from entry. Real Faire repro: a hook called inside a
// ternary branch, double-suppressed (react-hooks/rules-of-hooks +
// react-compiler) in Filters/__internal__/FilterOption.tsx.
runCfgCases("cfg-regression / conditional hook (rules of hooks)", [
  {
    name: "BUG: hook guarded by an if is conditional",
    code: `
      function Component() {
        if (cond) {
          useState();
        }
        tail();
      }
    `,
    unconditional: { useState: false, tail: true },
  },
  {
    // Expression-level lowering: the CFG now gives a ternary's arms their
    // own blocks (like the React Compiler's HIR), so a hook in a ternary
    // branch is correctly seen as conditional. The real Faire repro
    // (FilterOption.tsx) is exactly this shape. The `fallback()` alternate is
    // likewise conditional; only the merged value after the ternary is not.
    name: "BUG: hook in a ternary branch is conditional",
    code: `
      function Component() {
        const value = cond ? useFilterSectionSelectedChange() : fallback();
        return value;
      }
    `,
    unconditional: { useFilterSectionSelectedChange: false, fallback: false },
  },
  {
    name: "BUG: hook in a `&&` right operand is conditional (short-circuited)",
    code: `
      function Component() {
        const value = cond && useFeatureFlag();
        return value;
      }
    `,
    unconditional: { useFeatureFlag: false },
  },
  {
    name: "BUG: hook in a `??` right operand is conditional",
    code: `
      function Component() {
        const value = preset ?? useDefaultPreset();
        return value;
      }
    `,
    unconditional: { useDefaultPreset: false },
  },
  {
    name: "BUG: setState in a `&&` right operand is conditional",
    code: `
      function Component() {
        shouldReset && setState(0);
        return null;
      }
    `,
    unconditional: { setState: false },
  },
  {
    name: "OK twin: ternary test runs unconditionally; only the arms branch",
    code: `
      function Component() {
        const value = decideCondition() ? a() : b();
        return value;
      }
    `,
    unconditional: { decideCondition: true, a: false, b: false },
  },
  {
    name: "BUG: hook after an early return is conditional",
    code: `
      function Component() {
        if (cond) return;
        useState();
      }
    `,
    unconditional: { useState: false },
  },
  {
    name: "BUG: hook inside a loop runs once per iteration",
    code: `
      function Component() {
        for (const item of items()) {
          useState();
        }
      }
    `,
    insideLoop: { useState: true },
    unconditional: { useState: false },
  },
  {
    name: "OK twin: top-level hook is unconditional and not in a loop",
    code: `
      function Component() {
        useState();
        useEffect();
        return body();
      }
    `,
    unconditional: { useState: true, useEffect: true },
    insideLoop: { useState: false },
  },
]);

// 2. Path-sensitive effect leak — a resource is acquired, then an early
// return on some path exits before the cleanup, so the cleanup does NOT
// post-dominate the acquisition. The must-stay-quiet twin is the idiomatic
// guard-BEFORE-acquire, which AST matching cannot tell apart. Real Faire
// repro: OrderIssuesTable.tsx (new AbortController() then `if (isError) return`).
runCfgCases("cfg-regression / path-sensitive effect leak (post-dominance)", [
  {
    name: "BUG: acquire-then-early-return leaks (cleanup does not post-dominate)",
    code: `
      function effect() {
        acquire();
        if (errored) {
          return;
        }
        cleanup();
      }
    `,
    // The detection signal a leak rule keys on: the cleanup does NOT run on
    // every path out of the acquisition (the `errored` path returns first).
    postDominates: [["cleanup", "acquire", false]],
    reachable: [["acquire", "cleanup", true]],
  },
  {
    name: "OK twin: guard-before-acquire always cleans up",
    code: `
      function effect() {
        if (errored) {
          return;
        }
        acquire();
        cleanup();
      }
    `,
    postDominates: [["cleanup", "acquire", true]],
  },
  {
    name: "BUG: cleanup only on one branch is not guaranteed",
    code: `
      function effect() {
        acquire();
        if (branch) {
          cleanup();
        }
      }
    `,
    postDominates: [["cleanup", "acquire", false]],
  },
]);

// 3. Unconditional setState/dispatch in render → infinite render. Guarded
// setState (the React-sanctioned store-previous-render pattern) is NOT
// unconditional and must stay quiet.
runCfgCases("cfg-regression / unconditional setState in render", [
  {
    name: "BUG: bare setState in render body is unconditional",
    code: `
      function Component() {
        setState();
        return null;
      }
    `,
    unconditional: { setState: true },
  },
  {
    name: "OK twin: guarded setState (store-previous-render) is conditional",
    code: `
      function Component() {
        if (value !== prev) {
          setState();
        }
        return null;
      }
    `,
    unconditional: { setState: false },
  },
]);

// 4. Unreachable code after an abrupt completion.
runCfgCases("cfg-regression / unreachable after abrupt completion", [
  {
    name: "BUG: statement after an unconditional return is dead",
    code: `
      function fn() {
        done();
        return;
        dead();
      }
    `,
    unreachable: { done: false, dead: true },
    reachable: [["done", "dead", false]],
  },
  {
    name: "try/finally: code after `try { return } finally {}` is dead, finally still runs",
    code: `
      function fn() {
        try {
          return;
        } finally {
          cleanup();
        }
        after();
      }
    `,
    unreachable: { cleanup: false, after: true },
  },
]);
