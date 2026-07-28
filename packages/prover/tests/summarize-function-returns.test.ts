import ts from "typescript";
import { describe, expect, it } from "vite-plus/test";
import { summarizeFunctionReturns } from "../src/summarize-function-returns.js";

const parseArrowFunction = (sourceText: string): ts.ArrowFunction => {
  const sourceFile = ts.createSourceFile(
    "factory.ts",
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  let arrowFunction: ts.ArrowFunction | null = null;
  const visit = (node: ts.Node): void => {
    if (arrowFunction) return;
    if (ts.isArrowFunction(node)) {
      arrowFunction = node;
      return;
    }
    node.forEachChild(visit);
  };
  sourceFile.forEachChild(visit);
  if (!arrowFunction) throw new Error("The test source has no arrow function");
  return arrowFunction;
};

describe("summarizeFunctionReturns", () => {
  it("recognizes an expression body as one unconditional return", () => {
    const summary = summarizeFunctionReturns(parseArrowFunction("const factory = () => handler;"));

    expect(summary.isComplete).toBe(true);
    expect(summary.canFallThrough).toBe(false);
    expect(summary.expressions).toHaveLength(1);
    expect(summary.expressions[0]?.isConditionallyReached).toBe(false);
  });

  it("covers an early return and final return as conditional alternatives", () => {
    const summary = summarizeFunctionReturns(
      parseArrowFunction(`
        const factory = (condition: boolean) => {
          if (condition) return primaryHandler;
          return secondaryHandler;
        };
      `),
    );

    expect(summary.isComplete).toBe(true);
    expect(summary.canFallThrough).toBe(false);
    expect(summary.expressions).toHaveLength(2);
    expect(summary.expressions.every((expression) => expression.isConditionallyReached)).toBe(true);
  });

  it("covers nested exhaustive branches without a fallthrough path", () => {
    const summary = summarizeFunctionReturns(
      parseArrowFunction(`
        const factory = (outer: boolean, inner: boolean) => {
          if (outer) {
            if (inner) return firstHandler;
            return secondHandler;
          } else {
            return thirdHandler;
          }
        };
      `),
    );

    expect(summary.isComplete).toBe(true);
    expect(summary.canFallThrough).toBe(false);
    expect(summary.expressions).toHaveLength(3);
  });

  it("keeps a partial branch incomplete through a later conditional return", () => {
    const summary = summarizeFunctionReturns(
      parseArrowFunction(`
        const factory = (outer: boolean, inner: boolean) => {
          if (outer && inner) return firstHandler;
        };
      `),
    );

    expect(summary.isComplete).toBe(true);
    expect(summary.canFallThrough).toBe(true);
    expect(summary.expressions).toHaveLength(1);
  });

  it("covers every terminating clause when a switch has a default", () => {
    const summary = summarizeFunctionReturns(
      parseArrowFunction(`
        const factory = () => {
          switch (mode) {
            case "primary":
              return firstHandler;
            default:
              return secondHandler;
          }
        };
      `),
    );

    expect(summary.isComplete).toBe(true);
    expect(summary.canFallThrough).toBe(false);
    expect(summary.expressions).toHaveLength(2);
    expect(summary.expressions.every((expression) => expression.isConditionallyReached)).toBe(true);
  });

  it("keeps a switch without a checked exhaustive type open", () => {
    const summary = summarizeFunctionReturns(
      parseArrowFunction(`
        const factory = () => {
          switch (mode) {
            case "primary":
              return firstHandler;
            case "secondary":
              return secondHandler;
          }
        };
      `),
    );

    expect(summary.isComplete).toBe(true);
    expect(summary.canFallThrough).toBe(true);
    expect(summary.expressions).toHaveLength(2);
  });

  it("fails closed when a switch clause can fall through", () => {
    const summary = summarizeFunctionReturns(
      parseArrowFunction(`
        const factory = () => {
          switch (mode) {
            case "primary":
              if (condition) return firstHandler;
            default:
              return secondHandler;
          }
        };
      `),
    );

    expect(summary.isComplete).toBe(false);
    expect(summary.canFallThrough).toBe(true);
  });

  it("covers return alternatives from both try and catch paths", () => {
    const summary = summarizeFunctionReturns(
      parseArrowFunction(`
        const factory = () => {
          try {
            return firstHandler;
          } catch {
            return secondHandler;
          }
        };
      `),
    );

    expect(summary.isComplete).toBe(true);
    expect(summary.canFallThrough).toBe(false);
    expect(summary.expressions).toHaveLength(2);
    expect(summary.expressions.every((expression) => expression.isConditionallyReached)).toBe(true);
  });

  it("discharges an explicit throw through a returning catch", () => {
    const summary = summarizeFunctionReturns(
      parseArrowFunction(`
        const factory = () => {
          try {
            throw new Error("fallback");
          } catch {
            return fallbackHandler;
          }
        };
      `),
    );

    expect(summary.isComplete).toBe(true);
    expect(summary.canFallThrough).toBe(false);
    expect(summary.expressions).toHaveLength(1);
  });

  it("keeps a catch fallthrough path open", () => {
    const summary = summarizeFunctionReturns(
      parseArrowFunction(`
        const factory = () => {
          try {
            return firstHandler;
          } catch {}
        };
      `),
    );

    expect(summary.isComplete).toBe(true);
    expect(summary.canFallThrough).toBe(true);
    expect(summary.expressions).toHaveLength(1);
  });

  it("fails closed when a catch rethrows", () => {
    const summary = summarizeFunctionReturns(
      parseArrowFunction(`
        const factory = () => {
          try {
            return firstHandler;
          } catch (error) {
            throw error;
          }
        };
      `),
    );

    expect(summary.isComplete).toBe(false);
    expect(summary.canFallThrough).toBe(false);
    expect(summary.expressions).toHaveLength(1);
  });

  it("preserves protected returns through a normally completing finally", () => {
    const summary = summarizeFunctionReturns(
      parseArrowFunction(`
        const factory = () => {
          try {
            return firstHandler;
          } catch {
            return secondHandler;
          } finally {
            completed = true;
          }
        };
      `),
    );

    expect(summary.isComplete).toBe(true);
    expect(summary.canFallThrough).toBe(false);
    expect(summary.expressions).toHaveLength(2);
  });

  it("replaces protected returns with an unconditional finally return", () => {
    const summary = summarizeFunctionReturns(
      parseArrowFunction(`
        const factory = () => {
          try {
            return firstHandler;
          } finally {
            return finalHandler;
          }
        };
      `),
    );

    expect(summary.isComplete).toBe(true);
    expect(summary.canFallThrough).toBe(false);
    expect(summary.expressions).toHaveLength(1);
    expect(summary.expressions[0]?.expression.getText()).toBe("finalHandler");
  });

  it("combines protected and conditional finally returns", () => {
    const summary = summarizeFunctionReturns(
      parseArrowFunction(`
        const factory = () => {
          try {
            return firstHandler;
          } finally {
            if (useFinalHandler) return finalHandler;
          }
        };
      `),
    );

    expect(summary.isComplete).toBe(true);
    expect(summary.canFallThrough).toBe(false);
    expect(summary.expressions).toHaveLength(2);
  });

  it("fails closed for an uncaught finally throw", () => {
    const summary = summarizeFunctionReturns(
      parseArrowFunction(`
        const factory = () => {
          try {
            return firstHandler;
          } finally {
            throw new Error("failed");
          }
        };
      `),
    );

    expect(summary.isComplete).toBe(false);
    expect(summary.canFallThrough).toBe(false);
    expect(summary.expressions).toHaveLength(0);
  });

  it("joins zero-iteration and first-iteration returns from a terminating while body", () => {
    const summary = summarizeFunctionReturns(
      parseArrowFunction(`
        const factory = () => {
          while (useFirstHandler) return firstHandler;
          return secondHandler;
        };
      `),
    );

    expect(summary.isComplete).toBe(true);
    expect(summary.canFallThrough).toBe(false);
    expect(summary.expressions).toHaveLength(2);
  });

  it("recognizes a terminal body in an unconditional while loop", () => {
    const summary = summarizeFunctionReturns(
      parseArrowFunction(`
        const factory = () => {
          while (true) {
            return firstHandler;
          }
        };
      `),
    );

    expect(summary.isComplete).toBe(true);
    expect(summary.canFallThrough).toBe(false);
    expect(summary.expressions).toHaveLength(1);
  });

  it("ignores an unreachable body in a literal-false while loop", () => {
    const summary = summarizeFunctionReturns(
      parseArrowFunction(`
        const factory = () => {
          while (false) return firstHandler;
          return secondHandler;
        };
      `),
    );

    expect(summary.isComplete).toBe(true);
    expect(summary.canFallThrough).toBe(false);
    expect(summary.expressions).toHaveLength(1);
    expect(summary.expressions[0]?.expression.getText()).toBe("secondHandler");
  });

  it("proves a one-pass do-while-false branch join", () => {
    const summary = summarizeFunctionReturns(
      parseArrowFunction(`
        const factory = () => {
          do {
            if (useFirstHandler) return firstHandler;
          } while (false);
          return secondHandler;
        };
      `),
    );

    expect(summary.isComplete).toBe(true);
    expect(summary.canFallThrough).toBe(false);
    expect(summary.expressions).toHaveLength(2);
  });

  it("recognizes a terminal body in an unconditional for loop", () => {
    const summary = summarizeFunctionReturns(
      parseArrowFunction(`
        const factory = () => {
          for (;;) return firstHandler;
        };
      `),
    );

    expect(summary.isComplete).toBe(true);
    expect(summary.canFallThrough).toBe(false);
    expect(summary.expressions).toHaveLength(1);
  });

  it("proves finite iteration over a fresh array literal", () => {
    const summary = summarizeFunctionReturns(
      parseArrowFunction(`
        const factory = () => {
          for (const mode of ["primary", "secondary"]) {
            if (mode === selectedMode) return firstHandler;
          }
          return secondHandler;
        };
      `),
    );

    expect(summary.isComplete).toBe(true);
    expect(summary.canFallThrough).toBe(false);
    expect(summary.expressions).toHaveLength(2);
  });

  it.each([
    `const factory = () => {
      while (condition) {
        if (otherCondition) return firstHandler;
      }
      return secondHandler;
    };`,
    `const factory = () => {
      do {
        if (condition) return firstHandler;
      } while (otherCondition);
      return secondHandler;
    };`,
    `const factory = () => {
      for (const mode of [...modes]) {
        if (mode === "primary") return firstHandler;
      }
      return secondHandler;
    };`,
    `const factory = () => {
      for (const mode of modes) {
        if (mode === "primary") return firstHandler;
      }
      return secondHandler;
    };`,
    `const factory = () => {
      for (const mode of ["primary"]) {
        if (mode === selectedMode) break;
      }
      return secondHandler;
    };`,
  ])("fails closed when loop termination is unproved in %s", (sourceText) => {
    const summary = summarizeFunctionReturns(parseArrowFunction(sourceText));

    expect(summary.isComplete).toBe(false);
  });

  it.each([
    "const factory = () => { return; };",
    "const factory = () => { throw new Error('no handler'); };",
  ])("fails closed when an exit cannot produce a callable in %s", (sourceText) => {
    const summary = summarizeFunctionReturns(parseArrowFunction(sourceText));

    expect(summary.isComplete).toBe(false);
    expect(summary.canFallThrough).toBe(false);
    expect(summary.expressions).toHaveLength(0);
  });

  it("ignores unreachable returns after a terminating statement", () => {
    const summary = summarizeFunctionReturns(
      parseArrowFunction(`
        const factory = () => {
          return firstHandler;
          return secondHandler;
        };
      `),
    );

    expect(summary.isComplete).toBe(true);
    expect(summary.expressions).toHaveLength(1);
    expect(summary.expressions[0]?.expression.getText()).toBe("firstHandler");
  });
});
