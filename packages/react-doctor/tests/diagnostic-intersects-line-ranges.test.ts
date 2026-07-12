import type { Diagnostic } from "@react-doctor/core";
import { describe, expect, it } from "vite-plus/test";
import { diagnosticIntersectsLineRanges } from "../src/cli/utils/diagnostic-intersects-line-ranges.js";

const buildDiagnostic = (overrides: Partial<Diagnostic> = {}): Diagnostic => ({
  filePath: "src/App.tsx",
  plugin: "react-doctor",
  rule: "button-has-type",
  severity: "error",
  message: "Button is missing an explicit type",
  help: 'Add type="button"',
  line: 2,
  column: 3,
  category: "Accessibility",
  ...overrides,
});

describe("diagnosticIntersectsLineRanges", () => {
  it("keeps a multiline diagnostic when a changed continuation line intersects its span", () => {
    const diagnostic = buildDiagnostic({ line: 2, endLine: 5 });

    expect(diagnosticIntersectsLineRanges(diagnostic, [[4, 4]])).toBe(true);
  });

  it("keeps anchor-line behavior when no end line is available", () => {
    const diagnostic = buildDiagnostic({ line: 2 });

    expect(diagnosticIntersectsLineRanges(diagnostic, [[2, 2]])).toBe(true);
    expect(diagnosticIntersectsLineRanges(diagnostic, [[3, 3]])).toBe(false);
  });

  it("drops a diagnostic whose complete span misses every changed range", () => {
    const diagnostic = buildDiagnostic({ line: 2, endLine: 5 });

    expect(
      diagnosticIntersectsLineRanges(diagnostic, [
        [1, 1],
        [6, 8],
      ]),
    ).toBe(false);
  });
});
