import { describe, expect, it } from "vite-plus/test";
import type { Diagnostic } from "@react-doctor/core";
import { formatRuleSummary } from "../src/cli/utils/render-diagnostics.js";

const makeDiagnostic = (overrides: Partial<Diagnostic> = {}): Diagnostic => ({
  filePath: "src/App.tsx",
  plugin: "react-hooks-js",
  rule: "use-memo",
  severity: "error",
  title: "React Compiler can't optimize this",
  message:
    "This component misses React Compiler's automatic memoization & re-renders more than it should: useMemo() callbacks may not be async or generator functions. Rewrite the flagged code so the compiler can optimize it.",
  help: "",
  line: 3,
  column: 1,
  category: "Performance",
  ...overrides,
});

describe("formatRuleSummary", () => {
  it("prints the shared message once for a fixed-message rule", () => {
    const summary = formatRuleSummary("react-hooks-js/use-memo", [
      makeDiagnostic(),
      makeDiagnostic({ filePath: "src/Other.tsx", line: 9 }),
    ]);

    expect(summary.match(/misses React Compiler's automatic memoization/g)).toHaveLength(1);
    expect(summary).toContain("Count: 2");
  });

  it("lists every distinct per-site message instead of presenting the first as rule-wide", () => {
    const impureMessage =
      "This component misses React Compiler's automatic memoization & re-renders more than it should: This value is impure. Rewrite the flagged code so the compiler can optimize it.";
    const summary = formatRuleSummary("react-hooks-js/use-memo", [
      makeDiagnostic(),
      makeDiagnostic({ filePath: "src/Other.tsx", line: 9, message: impureMessage }),
    ]);

    expect(summary).toContain("useMemo() callbacks may not be async or generator functions");
    expect(summary).toContain("This value is impure");
  });
});
