import { runCfgCases } from "../../test-utils/run-cfg.js";

// Expression-level control flow — the CFG lowers a ternary's arms, a
// `&&`/`||`/`??` right operand, and a logical assignment's RHS into their own
// basic blocks, mirroring the React Compiler's HIR (and oxc_cfg). This is the
// layer statement-only lowering is blind to, and the one that makes a hook /
// setState / effect nested in a short-circuit correctly read as conditional.
// Each fact is paired with its straight-line twin so the boundary is locked.

// 1. Ternary: the test runs unconditionally, both arms are conditional, and
// the value after the ternary reconverges (unconditional again).
runCfgCases("cfg-expression-flow / ternary", [
  {
    name: "test is unconditional, both arms conditional, tail reconverges",
    code: `
      function Component() {
        const value = decide() ? onTrue() : onFalse();
        after();
        return value;
      }
    `,
    unconditional: { decide: true, onTrue: false, onFalse: false, after: true },
    reachable: [
      ["decide", "onTrue", true],
      ["decide", "onFalse", true],
      ["onTrue", "after", true],
      ["onFalse", "after", true],
      // The arms are mutually exclusive — neither flows into the other.
      ["onTrue", "onFalse", false],
      ["onFalse", "onTrue", false],
    ],
    dominates: [
      ["decide", "onTrue", true],
      ["decide", "onFalse", true],
      // Neither arm dominates the tail (the other arm reaches it too).
      ["onTrue", "after", false],
      ["onFalse", "after", false],
      ["onTrue", "onFalse", false],
    ],
    postDominates: [
      // The tail runs on every path out of the test; an arm does not.
      ["after", "decide", true],
      ["onTrue", "decide", false],
      ["onFalse", "decide", false],
    ],
    insideLoop: { onTrue: false },
  },
  {
    name: "nested ternary: inner arms are doubly conditional",
    code: `
      function Component() {
        const value = outer() ? (inner() ? deep() : shallow()) : other();
        return value;
      }
    `,
    unconditional: { outer: true, inner: false, deep: false, shallow: false, other: false },
    reachable: [
      ["outer", "inner", true],
      ["inner", "deep", true],
      ["inner", "shallow", true],
      ["deep", "shallow", false],
      // The inner ternary lives entirely in the outer consequent arm.
      ["deep", "other", false],
      ["inner", "other", false],
    ],
  },
]);

// 2. Logical short-circuit: the left operand always runs; the right is
// conditional. Chains nest left-associatively, so each deeper right operand
// is more conditional than the last.
runCfgCases("cfg-expression-flow / logical short-circuit", [
  {
    name: "`&&` right operand is conditional",
    code: `
      function Component() {
        const value = enabled() && useFeature();
        return value;
      }
    `,
    unconditional: { enabled: true, useFeature: false },
    reachable: [["enabled", "useFeature", true]],
  },
  {
    name: "`||` right operand is conditional",
    code: `
      function Component() {
        const value = cached() || recompute();
        return value;
      }
    `,
    unconditional: { cached: true, recompute: false },
  },
  {
    name: "`??` right operand is conditional",
    code: `
      function Component() {
        const value = preset() ?? fallback();
        return value;
      }
    `,
    unconditional: { preset: true, fallback: false },
  },
  {
    name: "chained `&&`: only the first operand is unconditional",
    code: `
      function Component() {
        const value = first() && second() && third();
        return value;
      }
    `,
    unconditional: { first: true, second: false, third: false },
    reachable: [
      ["first", "second", true],
      ["second", "third", true],
      ["first", "third", true],
    ],
  },
  {
    name: "logical assignment RHS is conditional",
    code: `
      function Component() {
        let cache;
        cache ??= compute();
        return cache;
      }
    `,
    unconditional: { compute: false },
  },
]);

// 3. Statement position: an expression-statement short-circuit (a very common
// "fire this side effect only when X" shape) splits the block in place, and
// the code after it reconverges.
runCfgCases("cfg-expression-flow / statement position", [
  {
    name: "`cond && sideEffect()` as a statement is conditional; tail reconverges",
    code: `
      function handler() {
        shouldLog() && logEvent();
        always();
        return null;
      }
    `,
    unconditional: { shouldLog: true, logEvent: false, always: true },
    postDominates: [
      ["always", "shouldLog", true],
      ["logEvent", "shouldLog", false],
    ],
  },
  {
    name: "ternary inside a call argument: callee runs after the arms reconverge",
    code: `
      function Component() {
        return wrap(cond() ? onA() : onB());
      }
    `,
    unconditional: { cond: true, onA: false, onB: false, wrap: true },
    reachable: [
      ["onA", "onB", false],
      ["cond", "onA", true],
      ["onA", "wrap", true],
      ["onB", "wrap", true],
    ],
  },
  {
    name: "arrow expression body ternary: arms are conditional",
    code: `
      const Component = () => (cond() ? onA() : onB());
    `,
    unconditional: { cond: true, onA: false, onB: false },
  },
]);

// 4. Optional chaining (`?.`) — the compiler's `optional` terminal. The base
// runs unconditionally; everything to the right of a `?.` (a deeper access, a
// computed key, or a call's arguments) is short-circuited when the base is
// nullish, so it is conditional. The chain value reconverges at the join.
runCfgCases("cfg-expression-flow / optional chaining", [
  {
    name: "optional member call: base unconditional, call + args conditional",
    code: `
      function Component() {
        const value = getObject()?.compute(useFlag());
        return value;
      }
    `,
    unconditional: { getObject: true, compute: false, useFlag: false },
    reachable: [
      ["getObject", "compute", true],
      ["getObject", "useFlag", true],
    ],
  },
  {
    name: "optional call: argument is only evaluated when the callee is present",
    code: `
      function Component() {
        const value = handlers.onChange?.(buildPayload());
        return value;
      }
    `,
    unconditional: { onChange: false, buildPayload: false },
  },
  {
    name: "optional computed key is conditional",
    code: `
      function Component() {
        const value = registry?.[resolveKey()];
        return value;
      }
    `,
    unconditional: { resolveKey: false },
  },
  {
    name: "chained optionals: only the base is unconditional",
    code: `
      function Component() {
        const value = first()?.second()?.third();
        return value;
      }
    `,
    unconditional: { first: true, second: false, third: false },
    reachable: [
      ["first", "second", true],
      ["second", "third", true],
    ],
  },
  {
    name: "OK twin: a non-optional member chain is fully unconditional",
    code: `
      function Component() {
        const value = config.get(readDefault());
        return value;
      }
    `,
    unconditional: { get: true, readDefault: true },
  },
]);
