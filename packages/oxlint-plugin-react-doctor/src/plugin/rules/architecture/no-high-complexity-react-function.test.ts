import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { REACT_FUNCTION_CYCLOMATIC_COMPLEXITY_THRESHOLD } from "../../constants/thresholds.js";
import { noHighComplexityReactFunction } from "./no-high-complexity-react-function.js";

const buildSequentialBranches = (branchCount: number): string =>
  Array.from(
    { length: branchCount },
    (_, branchIndex) => `if (value === ${branchIndex}) return <p>${branchIndex}</p>;`,
  ).join("\n");

const buildConditionalExpressions = (branchCount: number): string =>
  Array.from(
    { length: branchCount },
    (_, branchIndex) =>
      `const choice${branchIndex} = value === ${branchIndex} ? ${branchIndex} : null;`,
  ).join("\n");

const buildOptionalMemberReads = (readCount: number): string =>
  Array.from(
    { length: readCount },
    (_, readIndex) => `<output>{defaults?.section?.field${readIndex}?.label}</output>`,
  ).join("\n");

const runComplexityRule = (code: string, filename = "fixture.tsx") => {
  const result = runRule(noHighComplexityReactFunction, code, { filename });
  expect(result.parseErrors).toEqual([]);
  return result.diagnostics;
};

describe("architecture/no-high-complexity-react-function", () => {
  it("remains a warning", () => {
    expect(noHighComplexityReactFunction.severity).toBe("warn");
  });

  it("reports a component whose CFG has too many independent paths", () => {
    const diagnostics = runComplexityRule(`
      function Checkout({ value }) {
        ${buildSequentialBranches(REACT_FUNCTION_CYCLOMATIC_COMPLEXITY_THRESHOLD)}
        return <p>fallback</p>;
      }
    `);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain(
      `cyclomatic complexity ${REACT_FUNCTION_CYCLOMATIC_COMPLEXITY_THRESHOLD + 1}`,
    );
  });

  it("reports nesting-heavy custom hooks", () => {
    const diagnostics = runComplexityRule(
      `function useSelection(value: number) {
        if (value > 0) {
          if (value > 1) {
            if (value > 2) {
              if (value > 3) {
                if (value > 4) {
                  if (value > 5) return value;
                }
              }
            }
          }
        }
        return 0;
      }`,
      "fixture.ts",
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain("cognitive complexity 21");
  });

  it("reports expression-heavy components even when their statement CFG is linear", () => {
    const diagnostics = runComplexityRule(`
      function SearchResults({ value }) {
        ${buildConditionalExpressions(REACT_FUNCTION_CYCLOMATIC_COMPLEXITY_THRESHOLD)}
        return <main>{choice0}</main>;
      }
    `);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain(
      `cyclomatic complexity ${REACT_FUNCTION_CYCLOMATIC_COMPLEXITY_THRESHOLD + 1}`,
    );
  });

  it("reports an anonymous component inside nested React HOCs", () => {
    const diagnostics = runComplexityRule(`
      import { forwardRef, memo } from "react";
      const SearchInput = memo(forwardRef((props, reference) => {
        ${buildSequentialBranches(REACT_FUNCTION_CYCLOMATIC_COMPLEXITY_THRESHOLD)}
        return <input ref={reference} />;
      }));
    `);

    expect(diagnostics).toHaveLength(1);
  });

  it("reports an anonymous default-exported function component", () => {
    const diagnostics = runComplexityRule(`
      export default function ({ value }) {
        ${buildSequentialBranches(REACT_FUNCTION_CYCLOMATIC_COMPLEXITY_THRESHOLD)}
        return <p>fallback</p>;
      }
    `);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain("`default export`");
  });

  it("reports an anonymous default-exported arrow component", () => {
    const diagnostics = runComplexityRule(`
      export default ({ value }) => {
        ${buildSequentialBranches(REACT_FUNCTION_CYCLOMATIC_COMPLEXITY_THRESHOLD)}
        return <p>fallback</p>;
      };
    `);

    expect(diagnostics).toHaveLength(1);
  });

  it("allows React functions at the complexity boundary", () => {
    expect(
      runComplexityRule(`
        function Results({ value }) {
          ${buildSequentialBranches(REACT_FUNCTION_CYCLOMATIC_COMPLEXITY_THRESHOLD - 1)}
          return <p>fallback</p>;
        }
      `),
    ).toHaveLength(0);
  });

  it("ignores a complex PascalCase service without React output", () => {
    expect(
      runComplexityRule(
        `function PricingService(value: number) {
          ${buildSequentialBranches(REACT_FUNCTION_CYCLOMATIC_COMPLEXITY_THRESHOLD).replaceAll("<p>", '"').replaceAll("</p>", '"')}
          return "fallback";
        }`,
        "fixture.ts",
      ),
    ).toHaveLength(0);
  });

  it("does not attribute nested callback complexity to the component", () => {
    expect(
      runComplexityRule(`
        function Results({ value }) {
          const selectResult = () => {
            ${buildSequentialBranches(REACT_FUNCTION_CYCLOMATIC_COMPLEXITY_THRESHOLD)}
            return <p>fallback</p>;
          };
          return <main>{selectResult()}</main>;
        }
      `),
    ).toHaveLength(0);
  });

  it("does not treat repeated optional member reads as control-flow complexity", () => {
    expect(
      runComplexityRule(`
        function SettingsForm({ defaults }) {
          return (
            <form>
              ${buildOptionalMemberReads(REACT_FUNCTION_CYCLOMATIC_COMPLEXITY_THRESHOLD + 1)}
            </form>
          );
        }
      `),
    ).toHaveLength(0);
  });

  it("ignores complex lowercase utility functions", () => {
    expect(
      runComplexityRule(`
        function chooseValue({ value }) {
          ${buildSequentialBranches(REACT_FUNCTION_CYCLOMATIC_COMPLEXITY_THRESHOLD)}
          return <p>fallback</p>;
        }
      `),
    ).toHaveLength(0);
  });

  it("ignores React-shaped code in a non-React JSX dialect", () => {
    expect(
      runComplexityRule(`
        import { createSignal } from "solid-js";
        function Results({ value }) {
          ${buildSequentialBranches(REACT_FUNCTION_CYCLOMATIC_COMPLEXITY_THRESHOLD)}
          return <p>fallback</p>;
        }
      `),
    ).toHaveLength(0);
  });

  it("ignores marker-only code in a non-React JSX dialect", () => {
    expect(
      runComplexityRule(`
        function Results({ value }) {
          ${buildSequentialBranches(REACT_FUNCTION_CYCLOMATIC_COMPLEXITY_THRESHOLD)}
          return <main classList={{ active: true }}>fallback</main>;
        }
      `),
    ).toHaveLength(0);
  });

  it("does not treat an unresolved classList prop as non-React ownership", () => {
    expect(
      runComplexityRule(`
        function Results({ value, classes }) {
          ${buildSequentialBranches(REACT_FUNCTION_CYCLOMATIC_COMPLEXITY_THRESHOLD)}
          return <main classList={classes}>fallback</main>;
        }
      `),
    ).toHaveLength(1);
  });

  it("lets an explicit React runtime override a dialect marker", () => {
    expect(
      runComplexityRule(`
        import React from "react";
        function Results({ value }) {
          ${buildSequentialBranches(REACT_FUNCTION_CYCLOMATIC_COMPLEXITY_THRESHOLD)}
          return <main classList={{ active: true }}>fallback</main>;
        }
      `),
    ).toHaveLength(1);
  });
});
