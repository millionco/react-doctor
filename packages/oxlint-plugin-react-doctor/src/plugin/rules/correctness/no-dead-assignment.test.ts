import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noDeadAssignment } from "./no-dead-assignment.js";

const run = (code: string) => runRule(noDeadAssignment, code, { filename: "fixture.tsx" });

describe("no-dead-assignment", () => {
  it("flags a value overwritten before any read", () => {
    const result = run(`
      function compute() {
        let total = expensive();
        total = cheap();
        return total;
      }
    `);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].nodeType).toBe("Identifier");
  });

  it("flags a dead store on every branch before a later use", () => {
    const result = run(`
      function compute(flag) {
        let value = 1;
        value = 2;
        if (flag) {
          value = 3;
        } else {
          value = 4;
        }
        return value;
      }
    `);
    // The `value = 1` AND `value = 2` initial writes are both dead — each is
    // overwritten before any read. Two diagnostics.
    expect(result.diagnostics).toHaveLength(2);
  });

  it("does NOT flag a write that is read on some path", () => {
    const result = run(`
      function compute(flag) {
        let value = 1;
        if (flag) {
          value = 2;
        }
        return value;
      }
    `);
    // `value = 1` reaches the return on the !flag path → live.
    expect(result.diagnostics).toEqual([]);
  });

  it("does NOT flag a loop-carried value read each iteration", () => {
    const result = run(`
      function sum(items) {
        let acc = 0;
        for (const item of items) {
          acc = acc + item;
        }
        return acc;
      }
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("does NOT flag a binding captured by a closure", () => {
    const result = run(`
      function make() {
        let count = 0;
        const read = () => count;
        count = 1;
        return read;
      }
    `);
    // SSA can't see the closure's read of count, so the rule stays silent.
    expect(result.diagnostics).toEqual([]);
  });

  it("does NOT flag a const (cannot be reassigned)", () => {
    const result = run(`
      function compute() {
        const value = 1;
        return value;
      }
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("does NOT flag a wholly-unused variable (no-unused-vars owns that)", () => {
    const result = run(`
      function compute() {
        let value = 1;
        value = 2;
      }
    `);
    // `value` is never read at all → not our concern; no read references.
    expect(result.diagnostics).toEqual([]);
  });

  it("does NOT flag a compound assignment (read-modify-write)", () => {
    const result = run(`
      function compute(start) {
        let total = start;
        total += 1;
        return total;
      }
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("does NOT flag a write whose value is read before the next write", () => {
    const result = run(`
      function compute() {
        let value = 1;
        log(value);
        value = 2;
        return value;
      }
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("does NOT flag a loop-carried state machine read at the next iteration (RDE: tldraw reorderShapes)", () => {
    // An unlabeled `break` inside a `switch` inside a `for` must break the
    // switch, not the loop — otherwise the loop-carried writes look dead.
    const result = run(`
      function reorder(children, moving, opts) {
        let state = { name: 'skipping' };
        for (let i = 0; i < children.length; i++) {
          const isMoving = moving.has(children[i]);
          switch (state.name) {
            case 'skipping': {
              if (!isMoving) continue;
              state = { name: 'selecting', selectIndex: i };
              break;
            }
            case 'selecting': {
              if (isMoving) continue;
              const { selectIndex } = state;
              compute(children[i + 1]?.index).forEach((index, k) => {
                use(children[selectIndex + k], index);
              });
              state = { name: 'skipping' };
              break;
            }
          }
        }
        return state;
      }
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("does NOT flag an init reassigned in a try and read after it (RDE: excalidraw localStorage)", () => {
    // If `getItem()` throws, the `null` init survives to the read after the
    // try — so it is live, not dead.
    const result = run(`
      function importFromLocalStorage() {
        let savedElements = null;
        try {
          savedElements = localStorage.getItem("elements");
        } catch (error) {
          console.error(error);
        }
        if (savedElements) {
          return JSON.parse(savedElements);
        }
        return [];
      }
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("does NOT flag a value assigned in a catch and read in an outer catch (RDE: bippy owner-stack)", () => {
    const result = run(`
      function determine(component) {
        let control;
        try {
          try {
            throw Error();
          } catch (caughtError) {
            control = caughtError;
          }
          component();
        } catch (sample) {
          if (control instanceof Error) {
            return [sample, control];
          }
        }
        return null;
      }
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("flags a dead store inside a loop body overwritten before use", () => {
    const result = run(`
      function compute(items) {
        let result;
        for (const item of items) {
          result = stale(item);
          result = fresh(item);
          use(result);
        }
        return result;
      }
    `);
    expect(result.diagnostics).toHaveLength(1);
  });
});
