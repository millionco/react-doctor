import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noSetStateInRender } from "./no-set-state-in-render.js";

const run = (code: string) => runRule(noSetStateInRender, code, { filename: "fixture.tsx" });

describe("no-set-state-in-render", () => {
  it("flags a bare top-level setter call in render", () => {
    const result = run(`
      import { useState } from "react";
      function Component() {
        const [count, setCount] = useState(0);
        setCount(count + 1);
        return null;
      }
    `);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("setCount()");
  });

  it("flags an unconditional setter assigned to a variable (not a bare statement)", () => {
    const result = run(`
      import { useState } from "react";
      function Component() {
        const [count, setCount] = useState(0);
        const ignored = setCount(count + 1);
        return null;
      }
    `);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an unconditional setter nested in a plain block", () => {
    const result = run(`
      import { useState } from "react";
      function Component() {
        const [count, setCount] = useState(0);
        {
          setCount(count + 1);
        }
        return null;
      }
    `);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet on the guarded store-previous-render fixed-point pattern", () => {
    const result = run(`
      import { useState } from "react";
      function Component({ count }) {
        const [prevCount, setPrevCount] = useState(count);
        if (prevCount !== count) {
          setPrevCount(count);
        }
        return null;
      }
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays quiet when the setter runs only after an early return", () => {
    const result = run(`
      import { useState } from "react";
      function Component({ ready }) {
        const [count, setCount] = useState(0);
        if (!ready) return null;
        setCount(count + 1);
        return null;
      }
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays quiet when the setter is inside an effect", () => {
    const result = run(`
      import { useState, useEffect } from "react";
      function Component() {
        const [count, setCount] = useState(0);
        useEffect(() => {
          setCount(count + 1);
        }, [count]);
        return null;
      }
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays quiet when the setter is inside an event handler", () => {
    const result = run(`
      import { useState } from "react";
      function Component() {
        const [count, setCount] = useState(0);
        const onClick = () => setCount(count + 1);
        return <button onClick={onClick} />;
      }
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("ignores setters that are not useState bindings in scope", () => {
    const result = run(`
      function Component() {
        setExternalThing(1);
        return null;
      }
    `);
    expect(result.diagnostics).toEqual([]);
  });
});
