import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noLoadingFlagResetOutsideFinally } from "./no-loading-flag-reset-outside-finally.js";

describe("closed Promise.allSettled array evaluation", () => {
  it.each([
    {
      name: "native Promise factories",
      outside: "",
      before: "",
      after: "",
      task: 'Promise.allSettled([Promise.resolve(42), Promise.reject("unavailable")])',
      diagnostics: 0,
    },
    {
      name: "native Promise.resolve without an argument",
      outside: "",
      before: "",
      after: "",
      task: "Promise.allSettled([Promise.resolve()])",
      diagnostics: 0,
    },
    {
      name: "an inline async function with a primitive result",
      outside: "",
      before: "",
      after: "",
      task: 'Promise.allSettled([(async () => "ready")()])',
      diagnostics: 0,
    },
    {
      name: "an inline async function with a primitive rejection",
      outside: "",
      before: "",
      after: "",
      task: 'Promise.allSettled([(async () => { throw "unavailable"; })()])',
      diagnostics: 0,
    },
    {
      name: "an initialized private async task",
      outside: "",
      before: "const getReady = async () => 42;",
      after: "",
      task: "Promise.allSettled([getReady()])",
      diagnostics: 0,
    },
    {
      name: "a native Promise factory among other scalar values",
      outside: "",
      before: "",
      after: "",
      task: 'Promise.allSettled([Promise.resolve(true), 42, null, "ready"])',
      diagnostics: 0,
    },
    {
      name: "a factory that can throw while producing the argument",
      outside: "",
      before: "",
      after: "",
      task: "Promise.allSettled([getTask()])",
      diagnostics: 1,
    },
    {
      name: "a getter that can throw before the combinator runs",
      outside: 'const value = { get current() { throw "missing"; } };',
      before: "",
      after: "",
      task: "Promise.allSettled([Promise.resolve(value.current)])",
      diagnostics: 1,
    },
    {
      name: "a visible replacement of Promise.resolve",
      outside: "",
      before: 'Promise.resolve = () => { throw "stopped"; };',
      after: "",
      task: "Promise.allSettled([Promise.resolve(42)])",
      diagnostics: 1,
    },
    {
      name: "a replacement through the Promise prototype",
      outside: "",
      before: 'const prototype = Promise.prototype; prototype.then = () => { throw "stopped"; };',
      after: "",
      task: "Promise.allSettled([Promise.resolve(42)])",
      diagnostics: 1,
    },
    {
      name: "a replaced array iterator",
      outside: "",
      before: 'Array.prototype[Symbol.iterator] = () => { throw "stopped"; };',
      after: "",
      task: "Promise.allSettled([Promise.resolve(42)])",
      diagnostics: 1,
    },
    {
      name: "a replaced iterator reached through a literal",
      outside: "",
      before: 'Object.getPrototypeOf([])[Symbol.iterator] = () => { throw "stopped"; };',
      after: "",
      task: "Promise.allSettled([Promise.resolve(42)])",
      diagnostics: 1,
    },
    {
      name: "a result array that can reject on fulfillment",
      outside: "",
      before: 'Object.defineProperty(Object.prototype, "then", { get() { throw "stopped"; } });',
      after: "",
      task: "Promise.allSettled([Promise.resolve(42)])",
      diagnostics: 1,
    },
    {
      name: "a const async task invoked before initialization",
      outside: "",
      before: "",
      after: "const getReady = async () => 42;",
      task: "Promise.allSettled([getReady()])",
      diagnostics: 1,
    },
    {
      name: "a mutable local task binding",
      outside: "",
      before: 'let getReady = async () => 42; getReady = () => { throw "stopped"; };',
      after: "",
      task: "Promise.allSettled([getReady()])",
      diagnostics: 1,
    },
    {
      name: "an async input mutating a built-in before it returns",
      outside: "",
      before: "",
      after: "",
      task: 'Promise.allSettled([(async () => { Promise.resolve = () => { throw "stopped"; }; return 1; })()])',
      diagnostics: 1,
    },
    {
      name: "an additional argument that can throw",
      outside: "",
      before: "",
      after: "",
      task: "Promise.allSettled([Promise.resolve(1)], fail())",
      diagnostics: 1,
    },
    {
      name: "an unproven iterable spread",
      outside: "",
      before: "",
      after: "",
      task: "Promise.allSettled([Promise.resolve(1), ...getTasks()])",
      diagnostics: 1,
    },
    {
      name: "a resolution argument with an executable getter",
      outside: "",
      before: "",
      after: "",
      task: 'Promise.allSettled([Promise.resolve({ get then() { Array.prototype[Symbol.iterator] = () => { throw "stopped"; }; } })])',
      diagnostics: 1,
    },
    {
      name: "an async task that evaluates an opaque exception expression",
      outside: "",
      before: "const getReady = async () => { throw String(cause); };",
      after: "",
      task: "Promise.allSettled([getReady()])",
      diagnostics: 1,
    },
    {
      name: "a destructured Promise prototype",
      outside: "",
      before:
        'const { __proto__: prototype } = Promise.resolve(); prototype.then = () => { throw "stopped"; };',
      after: "",
      task: "Promise.allSettled([Promise.resolve(42)])",
      diagnostics: 1,
    },
    {
      name: "a destructured array prototype that changes settlement",
      outside: "",
      before:
        'const { __proto__: prototype } = []; prototype.then = (_resolve, reject) => reject("stopped");',
      after: "",
      task: "Promise.allSettled([Promise.resolve(42)])",
      diagnostics: 1,
    },
    {
      name: "a prototype reached through a destructured constructor",
      outside: "",
      before:
        'const { constructor: ObjectType } = {}; const { prototype } = ObjectType; ObjectType.defineProperty(prototype, "then", { get() { throw "stopped"; } });',
      after: "",
      task: "Promise.allSettled([Promise.resolve(42)])",
      diagnostics: 1,
    },
    {
      name: "an assignment pattern exposing the array prototype",
      outside: "",
      before:
        'let prototype; ({ "__proto__": prototype } = []); prototype.then = (_resolve, reject) => reject("stopped");',
      after: "",
      task: "Promise.allSettled([Promise.resolve(42)])",
      diagnostics: 1,
    },
  ])("checks $name", ({ outside, before, after, task, diagnostics }) => {
    const source = `import { useState } from "react";
      ${outside}
      export function Panel() {
        const [loading, setLoading] = useState(false);
        const run = async () => {
          setLoading(true);
          ${before}
          await ${task};
          setLoading(false);
          ${after}
        };
        return <button disabled={loading} onClick={run}>Refresh</button>;
      }`;
    const result = runRule(noLoadingFlagResetOutsideFinally, source, { forceJsx: true });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(diagnostics);
  });
});
