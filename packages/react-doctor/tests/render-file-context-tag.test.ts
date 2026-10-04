import { describe, expect, it } from "vite-plus/test";
import type { Diagnostic } from "@react-doctor/core";
import { formatRuleSummary } from "../src/cli/utils/format-rule-summary.js";

const makeDiagnostic = (overrides: Partial<Diagnostic> = {}): Diagnostic => ({
  filePath: "src/App.tsx",
  plugin: "react-doctor",
  rule: "no-array-index-as-key",
  severity: "error",
  title: "Array index used as a key",
  message: "Reordering the list re-renders the wrong rows.",
  help: "Use a stable id as the key.",
  line: 3,
  column: 1,
  category: "Correctness",
  ...overrides,
});

describe("file-context tags in rendered diagnostics", () => {
  it("tags file sites in the per-rule text summary", () => {
    const summary = formatRuleSummary("react-doctor/no-array-index-as-key", [
      makeDiagnostic({ filePath: "src/utils/foo.spec.tsx", fileContext: "test" }),
      makeDiagnostic(),
    ]);
    expect(summary).toContain("src/utils/foo.spec.tsx:3 (test file)");
    expect(summary).toContain("src/App.tsx:3\n");
  });
});
