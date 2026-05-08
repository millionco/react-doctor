import { describe, expect, it } from "vite-plus/test";
import { buildHiddenDiagnosticsSummary } from "../src/utils/build-hidden-diagnostics-summary.js";
import { buildDiagnostic } from "./regressions/_helpers.js";

describe("buildHiddenDiagnosticsSummary", () => {
  it("returns an empty array when no diagnostics are hidden", () => {
    expect(buildHiddenDiagnosticsSummary([])).toEqual([]);
  });

  it("emits a single warning part with correct pluralization", () => {
    const oneWarning = buildHiddenDiagnosticsSummary([buildDiagnostic({ severity: "warning" })]);
    expect(oneWarning).toEqual([{ severity: "warning", count: 1, text: "⚠ 1 more warning" }]);

    const manyWarnings = buildHiddenDiagnosticsSummary(
      Array.from({ length: 69 }, () => buildDiagnostic({ severity: "warning" })),
    );
    expect(manyWarnings).toEqual([{ severity: "warning", count: 69, text: "⚠ 69 more warnings" }]);
  });

  it("emits a single error part with correct pluralization", () => {
    const oneError = buildHiddenDiagnosticsSummary([buildDiagnostic({ severity: "error" })]);
    expect(oneError).toEqual([{ severity: "error", count: 1, text: "✗ 1 more error" }]);

    const manyErrors = buildHiddenDiagnosticsSummary(
      Array.from({ length: 5 }, () => buildDiagnostic({ severity: "error" })),
    );
    expect(manyErrors).toEqual([{ severity: "error", count: 5, text: "✗ 5 more errors" }]);
  });

  it("orders errors before warnings when both severities are hidden", () => {
    const mixed = buildHiddenDiagnosticsSummary([
      buildDiagnostic({ severity: "warning" }),
      buildDiagnostic({ severity: "error" }),
      buildDiagnostic({ severity: "warning" }),
      buildDiagnostic({ severity: "error" }),
      buildDiagnostic({ severity: "warning" }),
    ]);
    expect(mixed).toEqual([
      { severity: "error", count: 2, text: "✗ 2 more errors" },
      { severity: "warning", count: 3, text: "⚠ 3 more warnings" },
    ]);
  });

  it("omits the warning part when only errors are hidden", () => {
    const errorsOnly = buildHiddenDiagnosticsSummary([
      buildDiagnostic({ severity: "error" }),
      buildDiagnostic({ severity: "error" }),
    ]);
    expect(errorsOnly).toHaveLength(1);
    expect(errorsOnly[0].severity).toBe("error");
  });

  it("omits the error part when only warnings are hidden", () => {
    const warningsOnly = buildHiddenDiagnosticsSummary([
      buildDiagnostic({ severity: "warning" }),
      buildDiagnostic({ severity: "warning" }),
    ]);
    expect(warningsOnly).toHaveLength(1);
    expect(warningsOnly[0].severity).toBe("warning");
  });
});
