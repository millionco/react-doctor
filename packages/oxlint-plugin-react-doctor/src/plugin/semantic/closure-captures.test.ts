import { describe, expect, it } from "@voidzero-dev/vite-plus-test";
import { closureCaptures } from "./closure-captures.js";
import { analyzeScopes } from "./scope-analysis.js";
import { attachParentReferences } from "../../test-utils/attach-parent-references.js";
import { parseFixture } from "../../test-utils/parse-fixture.js";
import type { EsTreeNode } from "../utils/es-tree-node.js";
import { isFunctionLike } from "../utils/is-function-like.js";

const analyze = (code: string) => {
  const parsed = parseFixture(code);
  attachParentReferences(parsed.program);
  return { scopes: analyzeScopes(parsed.program), program: parsed.program };
};

const findFunctionNode = (root: EsTreeNode, name: string): EsTreeNode | null => {
  let result: EsTreeNode | null = null;
  const visit = (node: EsTreeNode): void => {
    if (result) return;
    if (
      node.type === "FunctionDeclaration" &&
      (node as { id?: { name?: string } }).id?.name === name
    ) {
      result = node;
      return;
    }
    if (node.type === "VariableDeclarator") {
      const declarator = node as { id?: { name?: string }; init?: EsTreeNode };
      if (declarator.id?.name === name && declarator.init && isFunctionLike(declarator.init)) {
        result = declarator.init;
        return;
      }
    }
    const record = node as unknown as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (key === "parent") continue;
      const child = record[key];
      if (Array.isArray(child)) {
        for (const item of child) {
          if (item && typeof item === "object" && "type" in item) {
            visit(item as EsTreeNode);
            if (result) return;
          }
        }
      } else if (child && typeof child === "object" && "type" in (child as object)) {
        visit(child as EsTreeNode);
      }
    }
  };
  visit(root);
  return result;
};

const capturedNames = (captures: ReadonlyArray<{ resolvedSymbol: { name: string } | null }>) =>
  captures.map((capture) => capture.resolvedSymbol?.name).sort();

describe("closureCaptures", () => {
  it("collects references whose binding lives outside the function", () => {
    const { scopes, program } = analyze(`
      const useGreeting = () => {
        const greeting = "hi";
        const speak = () => greeting;
        return speak;
      };
    `);
    const speak = findFunctionNode(program, "speak")!;
    expect(capturedNames(closureCaptures(speak, scopes))).toEqual(["greeting"]);
  });

  it("excludes parameters and internal locals", () => {
    const { scopes, program } = analyze(`
      const shout = (subject) => {
        const punctuation = "!";
        return subject + punctuation;
      };
    `);
    const shout = findFunctionNode(program, "shout")!;
    expect(closureCaptures(shout, scopes)).toEqual([]);
  });

  it("excludes the function's own recursive self-reference", () => {
    const { scopes, program } = analyze(`
      function countdown(steps) {
        if (steps === 0) return;
        countdown(steps - 1);
      }
    `);
    const countdown = findFunctionNode(program, "countdown")!;
    expect(closureCaptures(countdown, scopes)).toEqual([]);
  });

  it("bubbles nested-function captures up to every enclosing function", () => {
    const { scopes, program } = analyze(`
      const useOuter = () => {
        const outerValue = 1;
        const middle = () => {
          const middleValue = 2;
          const inner = () => outerValue + middleValue;
          return inner;
        };
        return middle;
      };
    `);
    const middle = findFunctionNode(program, "middle")!;
    const inner = findFunctionNode(program, "inner")!;
    expect(capturedNames(closureCaptures(inner, scopes))).toEqual(["middleValue", "outerValue"]);
    expect(capturedNames(closureCaptures(middle, scopes))).toEqual(["outerValue"]);
    const useOuter = findFunctionNode(program, "useOuter")!;
    expect(closureCaptures(useOuter, scopes)).toEqual([]);
  });

  it("preserves source order across nested scopes", () => {
    const { scopes, program } = analyze(`
      const firstValue = 1;
      const nestedValue = 2;
      const lastValue = 3;
      const callback = () => {
        consume(firstValue);
        const nested = () => nestedValue;
        consume(lastValue);
        return nested;
      };
    `);
    const callback = findFunctionNode(program, "callback")!;
    const captures = closureCaptures(callback, scopes);

    expect(captures.map((capture) => capture.resolvedSymbol?.name)).toEqual([
      "firstValue",
      "nestedValue",
      "lastValue",
    ]);
  });

  it("captures runtime references in decorators", () => {
    const { scopes, program } = analyze(`
      const decorate = (value) => (target) => target;
      const decoratorValue = "value";
      const callback = () => {
        @decorate(decoratorValue)
        class Decorated {}
        return Decorated;
      };
    `);
    const callback = findFunctionNode(program, "callback")!;

    expect(capturedNames(closureCaptures(callback, scopes))).toEqual([
      "decorate",
      "decoratorValue",
    ]);
  });

  it("captures runtime references in parameter decorators", () => {
    const { scopes, program } = analyze(`
      const decorateParameter = () => {};
      const callback = () => {
        class Decorated {
          method(@decorateParameter value: string) {
            return value;
          }
        }
        return Decorated;
      };
    `);
    const callback = findFunctionNode(program, "callback")!;

    expect(capturedNames(closureCaptures(callback, scopes))).toEqual(["decorateParameter"]);
  });

  it("does not capture references from type-only syntax", () => {
    const { scopes, program } = analyze(`
      const runtimeValue = 1;
      const callback = () => {
        type RuntimeValue = typeof runtimeValue;
        return 1;
      };
    `);
    const callback = findFunctionNode(program, "callback")!;

    expect(closureCaptures(callback, scopes)).toEqual([]);
  });

  it("excludes globals (unresolved references)", () => {
    const { scopes, program } = analyze(`
      const report = () => {
        console.log(window.location.href);
      };
    `);
    const report = findFunctionNode(program, "report")!;
    expect(closureCaptures(report, scopes)).toEqual([]);
  });

  it("returns the memoized result on repeat calls with the same analysis", () => {
    const { scopes, program } = analyze(`
      const useCounter = () => {
        const step = 1;
        const increment = (count) => count + step;
        return increment;
      };
    `);
    const increment = findFunctionNode(program, "increment")!;
    const firstResult = closureCaptures(increment, scopes);
    const secondResult = closureCaptures(increment, scopes);
    expect(secondResult).toBe(firstResult);
    expect(capturedNames(secondResult)).toEqual(["step"]);
  });

  it("computes fresh results for a different ScopeAnalysis over the same AST", () => {
    const { scopes, program } = analyze(`
      const useLabel = () => {
        const label = "x";
        const describeLabel = () => label;
        return describeLabel;
      };
    `);
    const describeLabel = findFunctionNode(program, "describeLabel")!;
    const firstResult = closureCaptures(describeLabel, scopes);
    const freshScopes = analyzeScopes(program);
    const freshResult = closureCaptures(describeLabel, freshScopes);
    expect(freshResult).not.toBe(firstResult);
    expect(capturedNames(freshResult)).toEqual(capturedNames(firstResult));
  });
});
