import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noStaleClosureCapture } from "./no-stale-closure-capture.js";

const run = (code: string) => runRule(noStaleClosureCapture, code, { filename: "fixture.tsx" });

describe("no-stale-closure-capture", () => {
  it("flags a useCallback capturing a let reassigned later in render", () => {
    const result = run(`
      function Component() {
        let count = 0;
        const handler = useCallback(() => console.log(count), []);
        count = 1;
        return handler;
      }
    `);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].nodeType).toBe("Identifier");
  });

  it("flags a useEffect capturing a let reassigned later in render", () => {
    const result = run(`
      function Component() {
        let value = 0;
        useEffect(() => {
          report(value);
        }, []);
        value = compute();
        return null;
      }
    `);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does NOT flag a const capture (cannot be reassigned)", () => {
    const result = run(`
      function Component() {
        const count = 0;
        const handler = useCallback(() => console.log(count), []);
        return handler;
      }
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("does NOT flag a let that is never reassigned after capture", () => {
    const result = run(`
      function Component() {
        let count = 0;
        const handler = useCallback(() => console.log(count), []);
        return handler;
      }
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("does NOT flag a reassignment that happens BEFORE the capture", () => {
    const result = run(`
      function Component() {
        let count = 0;
        count = 1;
        const handler = useCallback(() => console.log(count), []);
        return handler;
      }
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("does NOT flag a non-hook call", () => {
    const result = run(`
      function Component() {
        let count = 0;
        const handler = wrap(() => console.log(count));
        count = 1;
        return handler;
      }
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("does NOT flag a variable local to the closure", () => {
    const result = run(`
      function Component() {
        const handler = useCallback(() => {
          let local = 0;
          local = 1;
          return local;
        }, []);
        return handler;
      }
    `);
    expect(result.diagnostics).toEqual([]);
  });
});
