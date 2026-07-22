import { describe, expect, it } from "vite-plus/test";
import type { Diagnostic } from "@react-doctor/core";
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
  it("groups rows under one header per category, ordered by display rank", () => {
    const rows = buildDiagnosticRows(
      [
        makeDiagnostic({ rule: "a", category: "Bugs" }),
        makeDiagnostic({ rule: "b", category: "Security", severity: "error" }),
        makeDiagnostic({ rule: "c", category: "Maintainability" }),
      ],
      [null],
    );

    const entries = buildDiagnosticListEntries(rows);
    const headers = entries.filter((entry) => entry.kind === "header");

    // Security (rank 0) before Bugs (rank 1) before Maintainability.
    expect(headers.map((header) => header.kind === "header" && header.category)).toEqual([
      "Security",
      "Bugs",
      "Maintainability",
    ]);
    // Every header is immediately followed by at least one item entry.
    for (const [index, entry] of entries.entries()) {
      if (entry.kind === "header") expect(entries[index + 1]?.kind).toBe("item");
    }
  });
});
