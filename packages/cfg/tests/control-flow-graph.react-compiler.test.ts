import { runCfgCases } from "./run-cfg.js";

// Curated port of the React Compiler's `BuildHIR` control-flow shapes
// (facebook/react → compiler/packages/babel-plugin-react-compiler/src/HIR/
// BuildHIR.ts + its `__tests__/fixtures/compiler` control-flow fixtures).
// The compiler lowers `if` / `switch` / loops / `try` and the value-block
// terminals (`logical` / `ternary` / `optional`) so that a call nested in a
// short-circuit is on a conditional path. We assert the same facts our
// rules consume — `isUnconditionalFromEntry`, `isInsideLoop`, `isReachable`
// — each paired with the unconditional "quiet twin".

runCfgCases("cfg-react-compiler / value-block terminals are conditional", [
  {
    name: "logical && right operand is conditional (lowerLogicalExpression)",
    code: `function C() { cond && useThing(); useAlways(); }`,
    unconditional: { useThing: false, useAlways: true },
  },
  {
    name: "logical || right operand is conditional",
    code: `function C() { cond || useFallback(); }`,
    unconditional: { useFallback: false },
  },
  {
    name: "nullish ?? right operand is conditional",
    code: `function C() { value ?? useDefault(); }`,
    unconditional: { useDefault: false },
  },
  {
    name: "ternary arms are both conditional (lowerConditionalExpression)",
    code: `function C() { const v = cond ? useA() : useB(); }`,
    unconditional: { useA: false, useB: false },
  },
  {
    name: "optional-chain continuation is conditional (lowerOptionalMemberExpression)",
    code: `function C() { obj?.method(track()); track2(); }`,
    unconditional: { track: false, track2: true },
  },
]);

runCfgCases("cfg-react-compiler / statement terminals", [
  {
    name: "if consequent is conditional, post-if value is unconditional",
    code: `function C() { if (cond()) { useThen(); } done(); }`,
    unconditional: { useThen: false, done: true },
    reachable: [["cond", "done", true]],
  },
  {
    name: "switch case body is conditional",
    code: `function C() { switch (x) { case 1: useOne(); break; default: useDefault(); } }`,
    unconditional: { useOne: false, useDefault: false },
  },
  {
    name: "while body executes once per iteration (isInsideLoop) and is conditional",
    code: `function C() { while (cond) { useLoop(); } }`,
    unconditional: { useLoop: false },
    insideLoop: { useLoop: true },
  },
  {
    name: "for-of body is inside the loop",
    code: `function C() { for (const item of items) { useEach(item); } }`,
    insideLoop: { useEach: true },
  },
  {
    name: "try body entry is unconditional, the catch handler is conditional",
    code: `function C() { try { useTry(); } catch (e) { useCatch(); } }`,
    unconditional: { useTry: true, useCatch: false },
  },
  {
    name: "guard that throws makes the tail unconditional (maybe-throw bypass)",
    code: `function C() { if (bad) throw err; useHook(); }`,
    unconditional: { useHook: true },
  },
]);
