import type { Diagnostic } from "@react-doctor/core";
import { describe, expect, it } from "vite-plus/test";
import { buildDiagnosticListEntries } from "../../src/cli/ink/lib/diagnostic-list-entries.js";
import { buildDiagnosticRows } from "../../src/cli/ink/lib/diagnostic-rows.js";

const makeDiagnostic = (overrides: Partial<Diagnostic>): Diagnostic => ({
  filePath: "src/App.tsx",
  plugin: "react-doctor",
  rule: "rule",
  severity: "warning",
  message: "",
  help: "",
  line: 1,
  column: 1,
  category: "Bugs",
  ...overrides,
});

describe("buildDiagnosticListEntries", () => {
  it("groups rows under category headings while preserving original row indexes", () => {
    const rows = buildDiagnosticRows(
      [
        makeDiagnostic({ rule: "bugs-rule", category: "Bugs" }),
        makeDiagnostic({ rule: "security-rule", category: "Security", severity: "error" }),
        makeDiagnostic({ rule: "maintainability-rule", category: "Maintainability" }),
      ],
      [null],
    );

    const entries = buildDiagnosticListEntries(rows);
    const headers = entries.filter((entry) => entry.kind === "header");
    const items = entries.filter((entry) => entry.kind === "item");

    expect(headers.map((header) => header.category)).toEqual([
      "Security",
      "Bugs",
      "Maintainability",
    ]);
    expect(items.map((item) => item.rowIndex)).toEqual([1, 0, 2]);
    for (const [entryIndex, entry] of entries.entries()) {
      if (entry.kind === "header") expect(entries[entryIndex + 1]?.kind).toBe("item");
    }
  });
});
