import { describe, expect, it } from "@voidzero-dev/vite-plus-test";
import { analyzeComplexity } from "./complexity.js";
import { collectChangeComplexityFunctionEntries } from "./change-complexity.js";
import { attachParentReferences } from "../../test-utils/attach-parent-references.js";
import { parseFixture } from "../../test-utils/parse-fixture.js";

const analyze = (code: string) => {
  const parsed = parseFixture(code);
  attachParentReferences(parsed.program);
  return analyzeComplexity(parsed.program, code);
};

const findFunction = (functions: ReturnType<typeof analyze>["functions"], name: string) =>
  functions.find((functionEntry) => functionEntry.name === name);

describe("complexity", () => {
  it("reports the module entry and best-effort function kinds", () => {
    const complexity = analyze(`
      const calculate = () => 1;
      function ExampleComponent() {
        return calculate();
      }
      const helpers = {
        renderRow() {
          return calculate();
        },
      };
      class Screen {
        loadData() {
          return calculate();
        }
      }
      const useSession = function () {
        return calculate();
      };
    `);

    expect(complexity.functions[0]).toMatchObject({
      name: "<module>",
      kind: "module",
    });
    expect(findFunction(complexity.functions, "calculate")).toMatchObject({
      kind: "arrow",
    });
    expect(findFunction(complexity.functions, "ExampleComponent")).toMatchObject({
      kind: "component",
    });
    expect(findFunction(complexity.functions, "renderRow")).toMatchObject({
      kind: "method",
    });
    expect(findFunction(complexity.functions, "loadData")).toMatchObject({
      kind: "method",
    });
    expect(findFunction(complexity.functions, "useSession")).toMatchObject({
      kind: "hook",
    });
  });

  it("uses the source text to report accurate line and column positions", () => {
    const complexity = analyze(`const before = 0;
function positioned() {
  return before;
}
`);

    expect(findFunction(complexity.functions, "positioned")).toMatchObject({
      line: 2,
      column: 0,
    });
  });

  it("qualifies same-named class methods by owner in diff keys", () => {
    const parsed = parseFixture(`
      class First {
        render() {
          return 1;
        }
      }

      class Second {
        render() {
          if (flag) {
            return 2;
          }
          return 0;
        }
      }
    `);
    attachParentReferences(parsed.program);
    const entries = collectChangeComplexityFunctionEntries(
      parsed.program,
      `
      class First {
        render() {
          return 1;
        }
      }

      class Second {
        render() {
          if (flag) {
            return 2;
          }
          return 0;
        }
      }
    `,
      "src/example.ts",
    );

    const renderEntries = entries.filter((entry) => entry.name === "render");
    expect(renderEntries).toHaveLength(2);
    expect(new Set(renderEntries.map((entry) => entry.key)).size).toBe(2);
    expect(renderEntries.some((entry) => entry.key.includes("class:First"))).toBe(true);
    expect(renderEntries.some((entry) => entry.key.includes("class:Second"))).toBe(true);
  });

  it("computes cyclomatic complexity from the CFG", () => {
    const complexity = analyze(`
      function linear() {
        call();
      }

      function singleIf() {
        if (cond) {
          call();
        }
      }

      function ifElse() {
        if (cond) {
          callA();
        } else {
          callB();
        }
      }

      function sequentialIfs() {
        if (condA) {
          callA();
        }
        if (condB) {
          callB();
        }
      }

      function forLoop() {
        for (let index = 0; index < 3; index += 1) {
          call();
        }
      }

      function switchCases(value) {
        switch (value) {
          case 1:
            first();
            break;
          case 2:
            second();
            break;
          default:
            other();
        }
      }
    `);

    expect(findFunction(complexity.functions, "linear")?.cyclomatic).toBe(1);
    expect(findFunction(complexity.functions, "singleIf")?.cyclomatic).toBe(2);
    expect(findFunction(complexity.functions, "ifElse")?.cyclomatic).toBe(2);
    expect(findFunction(complexity.functions, "sequentialIfs")?.cyclomatic).toBe(3);
    expect(findFunction(complexity.functions, "forLoop")?.cyclomatic).toBe(2);
    expect(findFunction(complexity.functions, "switchCases")?.cyclomatic).toBe(3);
  });

  it("tracks branch-introducing decision points independently of cyclomatic complexity", () => {
    const complexity = analyze(`
      function branchy(value) {
        if (value && left() && middle() || right()) {
          yes();
        }

        value ? one() : two();

        for (const item of items) {
          loop(item);
        }

        while (keepGoing) {
          spin();
        }

        do {
          bounce();
        } while (keepGoing);

        try {
          risky();
        } catch (error) {
          handle(error);
        }

        switch (value) {
          case 1:
            first();
            break;
          case 2:
            second();
            break;
          default:
            other();
        }
      }
    `);

    expect(findFunction(complexity.functions, "branchy")?.decisionPoints).toBe(11);
    expect(findFunction(complexity.functions, "branchy")?.cyclomatic).toBeGreaterThan(0);
  });

  it("matches the Sonar white-paper examples for cognitive complexity", () => {
    const complexity = analyze(`
      function getWords(number) {
        switch (number) {
          case 1:
            return "one";
          case 2:
            return "a couple";
          case 3:
            return "a few";
          default:
            return "lots";
        }
      }

      function sumOfPrimes(max) {
        let total = 0;
        OUT: for (let outerIndex = 1; outerIndex <= max; outerIndex += 1) {
          for (let innerIndex = 2; innerIndex < outerIndex; innerIndex += 1) {
            if (outerIndex % innerIndex === 0) {
              continue OUT;
            }
          }
          total += outerIndex;
        }
        return total;
      }
    `);

    expect(findFunction(complexity.functions, "getWords")?.cognitive).toBe(1);
    expect(findFunction(complexity.functions, "getWords")?.maxNestingDepth).toBe(1);
    expect(findFunction(complexity.functions, "sumOfPrimes")?.cognitive).toBe(7);
    expect(findFunction(complexity.functions, "sumOfPrimes")?.maxNestingDepth).toBe(3);
  });

  it("treats else-if as a fresh branch without extra nesting", () => {
    const complexity = analyze(`
      function choose(value) {
        if (value === 1) {
          first();
        } else if (value === 2) {
          second();
        } else {
          third();
        }
      }
    `);

    expect(findFunction(complexity.functions, "choose")?.cognitive).toBe(2);
    expect(findFunction(complexity.functions, "choose")?.maxNestingDepth).toBe(1);
  });

  it("counts logical operator runs once per sequence", () => {
    const complexity = analyze(`
      function logic(a, b, c, d) {
        return a && b && c || d;
      }
    `);

    expect(findFunction(complexity.functions, "logic")?.decisionPoints).toBe(3);
    expect(findFunction(complexity.functions, "logic")?.cognitive).toBe(2);
  });
});
