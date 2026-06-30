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
});
