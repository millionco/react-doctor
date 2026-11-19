import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noSideEffectInStateUpdaterFunction } from "./no-side-effect-in-state-updater-function.js";

describe("no-side-effect-in-state-updater-function — private Map fallback", () => {
  it("checks a fresh Map after the guarded fallback assignment", () => {
    const result = runRule(
      noSideEffectInStateUpdaterFunction,
      `
      import { useState } from 'react';
      export function Screen({ groups, saved }) {
        const [values, setValues] = useState(() => new globalThis.Map());
        return <button onClick={() => {
          setValues((previous) => {
            let next = null;
            for (const group of groups) {
              if (previous.has(group)) continue;
              next = next || new Map(previous);

              next.set(group, true);
            }
            return next || previous;
          });
        }}>{String(values.size)}</button>;
      }
    `,
      { filename: "fixture.jsx" },
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("checks a separate mutation of the previous Map", () => {
    const result = runRule(
      noSideEffectInStateUpdaterFunction,
      `
      import { useState } from 'react';
      export function Screen({ groups, saved }) {
        const [values, setValues] = useState(() => new globalThis.Map());
        return <button onClick={() => {
          setValues((previous) => {
            let next = null;
            for (const group of groups) {
              if (previous.has(group)) continue;
              next = next || new Map(previous);

              next.set(group, true);
              previous.set(group, false);
            }
            return next || previous;
          });
        }}>{String(values.size)}</button>;
      }
    `,
      { filename: "fixture.jsx" },
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("checks a fallback that keeps a different binding", () => {
    const result = runRule(
      noSideEffectInStateUpdaterFunction,
      `
      import { useState } from 'react';
      export function Screen({ groups, saved }) {
        const [values, setValues] = useState(() => new globalThis.Map());
        return <button onClick={() => {
          setValues((previous) => {
            let next = null;
            for (const group of groups) {
              if (previous.has(group)) continue;
              next = saved || new Map(previous);

              next.set(group, true);
            }
            return next || previous;
          });
        }}>{String(values.size)}</button>;
      }
    `,
      { filename: "fixture.jsx" },
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("checks a replacement for the global Map constructor", () => {
    const result = runRule(
      noSideEffectInStateUpdaterFunction,
      `
      import { useState } from 'react';
      const initial = new Map();
      globalThis.Map = function ReturningPrior(previous) { return previous; };
      export function Screen({ group, publish }) {
        const [values, setValues] = useState(initial);
        return <button onClick={() => {
          setValues((previous) => {
            let next = null;

            next = next || new Map(previous);
            next.set(group, true);
            return next || previous;
          });
        }}>{String(values.size)}</button>;
      }
    `,
      { filename: "fixture.jsx" },
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("checks a dynamic write to the local binding", () => {
    const result = runRule(
      noSideEffectInStateUpdaterFunction,
      `
      import { useState } from 'react';
      const initial = new Map();

      export function Screen({ group, publish }) {
        const [values, setValues] = useState(initial);
        return <button onClick={() => {
          setValues((previous) => {
            let next = null;
            eval("next = previous");
            next = next || new Map(previous);
            next.set(group, true);
            return next || previous;
          });
        }}>{String(values.size)}</button>;
      }
    `,
      { filename: "fixture.jsx" },
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("checks a previous Map whose iterator patches the prototype", () => {
    const result = runRule(
      noSideEffectInStateUpdaterFunction,
      `
      import { useState } from 'react';

      const seed = new Map([['already present', false]]);
      const originalSet = seed.set;
      const originalIterator = seed[Symbol.iterator].bind(seed);
      seed[Symbol.iterator] = () => {
        const prototypeOfSeed = Object.getPrototypeOf(seed);
        prototypeOfSeed.set = function (key, value) {
          return originalSet.call(seed, key, value);
        };
        return originalIterator();
      };

      export function Example() {
        const [values, setValues] = useState(() => seed);
        function update() {
          setValues((prev) => {
            let next = null;
            for (const key of ['reviewed']) {
              if (prev.has(key)) continue;
              next = next || new Map(prev);
              next.set(key, true);
            }
            return next || prev;
          });
        }
        return <button onClick={update}>{values.size}</button>;
      }
    `,
      { filename: "fixture.jsx" },
    );
    expect(result.diagnostics).toHaveLength(1);
  });
});
