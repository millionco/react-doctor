import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noSetStateInRenderLoop } from "./no-set-state-in-render-loop.js";

const run = (code: string) => runRule(noSetStateInRenderLoop, code, { filename: "fixture.tsx" });

describe("no-set-state-in-render-loop", () => {
  it("flags a setter called inside a for-of loop in render", () => {
    const result = run(`
      import { useState } from "react";
      function List({ items }) {
        const [selected, setSelected] = useState(null);
        for (const item of items) {
          setSelected(item);
        }
        return null;
      }
    `);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("setSelected");
  });

  it("flags a setter inside a classic for loop in render", () => {
    const result = run(`
      import { useState } from "react";
      function Counter({ n }) {
        const [count, setCount] = useState(0);
        for (let i = 0; i < n; i++) {
          setCount(i);
        }
        return null;
      }
    `);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a setter inside a while loop in render", () => {
    const result = run(`
      import { useState } from "react";
      function Component({ shouldRun }) {
        const [value, setValue] = useState(0);
        while (shouldRun()) {
          setValue(1);
        }
        return null;
      }
    `);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet for a setter inside an array map callback (separate function)", () => {
    const result = run(`
      import { useState } from "react";
      function List({ items }) {
        const [selected, setSelected] = useState(null);
        const rows = items.map((item) => {
          setSelected(item);
          return item;
        });
        return rows;
      }
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays quiet for a setter inside an event handler with a loop", () => {
    const result = run(`
      import { useState } from "react";
      function Component({ items }) {
        const [selected, setSelected] = useState(null);
        const onClick = () => {
          for (const item of items) {
            setSelected(item);
          }
        };
        return null;
      }
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays quiet for a setter called once outside any loop", () => {
    const result = run(`
      import { useState } from "react";
      function Component({ flag }) {
        const [value, setValue] = useState(0);
        if (flag) {
          setValue(1);
        }
        return null;
      }
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays quiet when there are no useState setters", () => {
    const result = run(`
      function List({ items, onPick }) {
        for (const item of items) {
          onPick(item);
        }
        return null;
      }
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("defers an unconditional `for (;;)` setter to no-set-state-in-render", () => {
    const result = run(`
      import { useState } from "react";
      function Component() {
        const [value, setValue] = useState(0);
        for (;;) {
          setValue(1);
        }
        return null;
      }
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("defers an unconditional `while (true)` setter to no-set-state-in-render", () => {
    const result = run(`
      import { useState } from "react";
      function Component() {
        const [value, setValue] = useState(0);
        while (true) {
          setValue(1);
        }
        return null;
      }
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("ignores setters in a non-component function", () => {
    const result = run(`
      import { useState } from "react";
      function helper({ items }) {
        const [selected, setSelected] = useState(null);
        for (const item of items) {
          setSelected(item);
        }
        return null;
      }
    `);
    expect(result.diagnostics).toEqual([]);
  });
});
