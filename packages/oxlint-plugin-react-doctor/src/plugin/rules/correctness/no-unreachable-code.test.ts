import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noUnreachableCode } from "./no-unreachable-code.js";

const run = (code: string) => runRule(noUnreachableCode, code, { filename: "fixture.tsx" });

describe("no-unreachable-code", () => {
  it("flags a statement after an unconditional return", () => {
    const result = run(`
      function compute() {
        return 1;
        doWork();
      }
    `);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].nodeType).toBe("ExpressionStatement");
  });

  it("flags a statement after a throw", () => {
    const result = run(`
      function compute() {
        throw new Error("boom");
        cleanup();
      }
    `);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags code after break inside a loop", () => {
    const result = run(`
      function compute(items) {
        for (const item of items) {
          break;
          process(item);
        }
      }
    `);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags code after continue", () => {
    const result = run(`
      function compute(items) {
        for (const item of items) {
          continue;
          process(item);
        }
      }
    `);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags code after an infinite loop (const-truthy test)", () => {
    const result = run(`
      function compute() {
        while (true) {
          tick();
        }
        afterLoop();
      }
    `);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an unreachable statement inside a switch case", () => {
    const result = run(`
      function compute(kind) {
        switch (kind) {
          case "a":
            return 1;
            log("a");
          default:
            return 0;
        }
      }
    `);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports a contiguous dead run only once", () => {
    const result = run(`
      function compute() {
        return 1;
        first();
        second();
        third();
      }
    `);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports a dead nested block once (not its inner statements too)", () => {
    const result = run(`
      function compute() {
        return 1;
        {
          inner();
        }
      }
    `);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].nodeType).toBe("BlockStatement");
  });

  it("skips a forward to the first runtime statement past a hoisted function", () => {
    const result = run(`
      function compute() {
        return 1;
        function helper() {}
        runHelper();
      }
    `);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].nodeType).toBe("ExpressionStatement");
  });

  it("flags code after both branches of an if/else return", () => {
    const result = run(`
      function compute(flag) {
        if (flag) {
          return 1;
        } else {
          return 2;
        }
        after();
      }
    `);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags code after a finally that returns", () => {
    const result = run(`
      function compute() {
        try {
          go();
        } finally {
          return 1;
        }
        after();
      }
    `);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags code after a labeled break", () => {
    const result = run(`
      function compute(items) {
        outer: for (const item of items) {
          break outer;
          process(item);
        }
      }
    `);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a dead class declaration (classes do not hoist like functions)", () => {
    const result = run(`
      function compute() {
        return 1;
        class Helper {}
      }
    `);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet when an early return is conditional", () => {
    const result = run(`
      function compute(flag) {
        if (flag) return 1;
        doWork();
      }
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not fold an `if (true)` test, so the following code is reachable", () => {
    const result = run(`
      function compute() {
        if (true) return 1;
        after();
      }
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag the next case of a switch fallthrough", () => {
    const result = run(`
      function compute(kind) {
        switch (kind) {
          case 1:
            doA();
          case 2:
            doB();
        }
      }
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays quiet for a hoisted function declaration after return", () => {
    const result = run(`
      function compute() {
        return 1;
        function helper() {}
      }
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays quiet for an infinite loop with a reachable break", () => {
    const result = run(`
      function compute(stop) {
        while (true) {
          if (stop()) break;
        }
        afterLoop();
      }
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays quiet for straight-line code with no jumps", () => {
    const result = run(`
      function compute() {
        const a = 1;
        const b = 2;
        return a + b;
      }
    `);
    expect(result.diagnostics).toEqual([]);
  });
});
