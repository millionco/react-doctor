import { describe, expect, it } from "vite-plus/test";
import { buildCategoryBreakdown } from "../src/core/build-category-breakdown.js";
import { buildDiagnostic } from "./regressions/_helpers.js";

describe("buildCategoryBreakdown", () => {
  it("returns an empty array when no diagnostics are provided", () => {
    expect(buildCategoryBreakdown([])).toEqual([]);
  });

  it("groups diagnostics by category and counts each severity", () => {
    const breakdown = buildCategoryBreakdown([
      buildDiagnostic({ category: "Next.js", severity: "warning" }),
      buildDiagnostic({ category: "Next.js", severity: "warning" }),
      buildDiagnostic({ category: "Performance", severity: "warning" }),
      buildDiagnostic({ category: "State & Effects", severity: "error" }),
    ]);
    expect(breakdown).toEqual([
      { category: "State & Effects", totalCount: 1, errorCount: 1, warningCount: 0 },
      { category: "Next.js", totalCount: 2, errorCount: 0, warningCount: 2 },
      { category: "Performance", totalCount: 1, errorCount: 0, warningCount: 1 },
    ]);
  });

  it("sorts categories with errors first, then by total count, then by name", () => {
    const breakdown = buildCategoryBreakdown([
      buildDiagnostic({ category: "Performance", severity: "warning" }),
      buildDiagnostic({ category: "Performance", severity: "warning" }),
      buildDiagnostic({ category: "Performance", severity: "warning" }),
      buildDiagnostic({ category: "Next.js", severity: "warning" }),
      buildDiagnostic({ category: "Next.js", severity: "warning" }),
      buildDiagnostic({ category: "Next.js", severity: "warning" }),
      buildDiagnostic({ category: "Architecture", severity: "warning" }),
      buildDiagnostic({ category: "State & Effects", severity: "error" }),
    ]);
    expect(breakdown.map((entry) => entry.category)).toEqual([
      "State & Effects",
      "Next.js",
      "Performance",
      "Architecture",
    ]);
  });
});
