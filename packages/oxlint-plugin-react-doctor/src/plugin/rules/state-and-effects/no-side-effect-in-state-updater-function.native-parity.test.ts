import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noSideEffectInStateUpdaterFunction } from "./no-side-effect-in-state-updater-function.js";

describe("state updater optional receiver parity", () => {
  it("preserves optional calls to fresh local factories", () => {
    const result = runRule(
      noSideEffectInStateUpdaterFunction,
      `
      import { useState } from 'react';
      const makeValues = () => new Map();
      export const Child = () => {
        const [value, setValue] = useState(0);
        return <button onClick={() => setValue(previous => {
          const values = makeValues?.();
          values.set('count', previous);
          return previous + 1;
        })}>{value}</button>;
      };
    `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
  it.each(["elementRef.current?.closest('.code')", "getElement()", "getElement?.()"])(
    "reports mutations of an external result from %s",
    (initializer) => {
      const result = runRule(
        noSideEffectInStateUpdaterFunction,
        `
        import { useState, useRef } from 'react';
        export function Toggle({ getElement }) {
          const [wrapped, setWrapped] = useState(false);
          const elementRef = useRef(null);
          const toggle = () => setWrapped(previous => {
            const element = ${initializer};
            if (element) element.setAttribute('data-wrapped', 'true');
            return !previous;
          });
          return <button onClick={toggle}>{String(wrapped)}</button>;
        }
      `,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    },
  );
});
