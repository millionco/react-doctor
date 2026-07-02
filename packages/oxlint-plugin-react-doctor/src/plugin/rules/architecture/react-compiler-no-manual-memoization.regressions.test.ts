import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { reactCompilerNoManualMemoization } from "./react-compiler-no-manual-memoization.js";

const run = (code: string) =>
  runRule(reactCompilerNoManualMemoization, code, { filename: "fixture.tsx" });

describe("architecture/react-compiler-no-manual-memoization — regressions", () => {
  it("does not flag memo() with a custom comparator", () => {
    const result = run(
      `import { memo } from "react"; const C = memo(Inner, (prev, next) => prev.id === next.id);`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a plain memo() with no comparator", () => {
    const result = run(`import { memo } from "react"; const C = memo(Inner);`);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("flags memo(Inner, undefined) — React falls back to shallow compare", () => {
    const result = run(`import { memo } from "react"; const C = memo(Inner, undefined);`);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("flags memo(Inner, null) — React falls back to shallow compare", () => {
    const result = run(`import { memo } from "react"; const C = memo(Inner, null);`);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("does not flag memo(Inner, ...rest) — the spread could carry a comparator", () => {
    const result = run(
      `import { memo } from "react"; const rest = []; const C = memo(Inner, ...rest);`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag an aliased memo import with a comparator", () => {
    const result = run(
      `import { memo as wrapMemo } from "react"; const C = wrapMemo(Inner, (a, b) => a.id === b.id);`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag React.memo with a comparator", () => {
    const result = run(
      `import React from "react"; const C = React.memo(Inner, (a, b) => a.id === b.id);`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag memo(Inner, comparatorIdentifier)", () => {
    const result = run(
      `import { memo } from "react"; const areEqual = (a, b) => a.id === b.id; const C = memo(Inner, areEqual);`,
    );
    expect(result.diagnostics).toEqual([]);
  });
});
