import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noSideEffectInStateUpdaterFunction } from "./no-side-effect-in-state-updater-function.js";

describe("state updater timer cancellation", () => {
  it.each([
    "clearInterval(timer)",
    "clearTimeout(timer)",
    "window.clearInterval(timer)",
    "globalThis.clearTimeout(timer)",
    "self.clearInterval(timer)",
    "window['clearTimeout'](timer)",
    "(globalThis as Window).clearInterval(timer)",
  ])("reports the executed native call %s", (cancellation) => {
    const source = `import { useState } from 'react';
      const Counter = ({ timer }) => {
        const [count, setCount] = useState(0);
        return <button onClick={() => setCount(previous => {
          ${cancellation};
          return previous + 1;
        })}>{count}</button>;
      };`;
    const result = runRule(noSideEffectInStateUpdaterFunction, source, { includeLocations: true });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    const diagnostic = result.diagnostics[0];
    expect(diagnostic.line).toBe(5);
    expect(diagnostic.nodeType).toBe("CallExpression");
  });

  it("follows a synchronous helper through setter and updater aliases", () => {
    const result = runRule(
      noSideEffectInStateUpdaterFunction,
      `import { useState as state } from 'react';
      const Counter = ({ timer }) => {
        const [count, setCount] = state(0);
        const cancel = () => clearInterval(timer);
        const update = previous => { cancel(); return previous + 1; };
        const commit = setCount;
        return <button onClick={() => commit(update)}>{count}</button>;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    "const clearInterval = value => value; clearInterval(timer);",
    "const window = { clearInterval: value => value }; window.clearInterval(timer);",
    "const self = { clearTimeout: value => value }; self.clearTimeout(timer);",
    "const globalThis = { clearTimeout: value => value }; globalThis.clearTimeout(timer);",
    "window.customTimers.clearInterval(timer);",
    "if (false) clearInterval(timer);",
    "const cancel = () => clearInterval(timer);",
    "return { count: previous, cancel: () => clearTimeout(timer) };",
    "return previous; clearTimeout(timer);",
  ])("keeps non-native or unexecuted cancellation quiet: %s", (body) => {
    const result = runRule(
      noSideEffectInStateUpdaterFunction,
      `import { useState } from 'react';
      const Counter = ({ timer }) => {
        const [count, setCount] = useState(0);
        return <button onClick={() => setCount(previous => {
          ${body}
          return previous;
        })}>{count}</button>;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("keeps effect cleanup outside a state updater quiet", () => {
    const result = runRule(
      noSideEffectInStateUpdaterFunction,
      `import { useEffect, useState } from 'react';
      const Counter = () => {
        const [count, setCount] = useState(0);
        useEffect(() => {
          const timer = setInterval(() => setCount(previous => previous + 1), 100);
          return () => clearInterval(timer);
        }, []);
        return <span>{count}</span>;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });
});
