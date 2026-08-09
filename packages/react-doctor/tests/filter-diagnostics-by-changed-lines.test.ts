import path from "node:path";
import type { Diagnostic } from "@react-doctor/core";
import { describe, expect, it } from "vite-plus/test";
import { filterDiagnosticsByChangedLines } from "../src/cli/utils/filter-diagnostics-by-changed-lines.js";

const buildDiagnostic = (
  filePath: string,
  line: number,
  overrides: Partial<Diagnostic> = {},
): Diagnostic => ({
  filePath,
  plugin: "react-doctor",
  rule: "button-has-type",
  severity: "error",
  message: "Button is missing an explicit type",
  help: 'Add type="button"',
  line,
  column: 1,
  category: "Accessibility",
  ...overrides,
});

describe("filterDiagnosticsByChangedLines", () => {
  it("preserves diagnostic order while matching relative and absolute paths", () => {
    const directory = path.resolve("/workspace/project");
    const firstDiagnostic = buildDiagnostic("src/first.tsx", 3);
    const droppedDiagnostic = buildDiagnostic("src/dropped.tsx", 7);
    const secondDiagnostic = buildDiagnostic(path.join(directory, "src/second.tsx"), 9);

    expect(
      filterDiagnosticsByChangedLines({
        directory,
        diagnostics: [firstDiagnostic, droppedDiagnostic, secondDiagnostic],
        changedLineRanges: [
          { file: "src/second.tsx", ranges: [[9, 9]] },
          { file: "src/first.tsx", ranges: [[3, 3]] },
        ],
      }),
    ).toEqual([firstDiagnostic, secondDiagnostic]);
  });

  it("normalizes backslashes in changed file paths", () => {
    const diagnostic = buildDiagnostic("src/App.tsx", 4);

    expect(
      filterDiagnosticsByChangedLines({
        directory: "/workspace/project",
        diagnostics: [diagnostic],
        changedLineRanges: [{ file: "src\\App.tsx", ranges: [[4, 4]] }],
      }),
    ).toEqual([diagnostic]);
  });

  it("uses the final entry when a changed file is listed more than once", () => {
    const diagnostic = buildDiagnostic("src/App.tsx", 4);

    expect(
      filterDiagnosticsByChangedLines({
        directory: "/workspace/project",
        diagnostics: [diagnostic],
        changedLineRanges: [
          { file: "src/App.tsx", ranges: [[4, 4]] },
          { file: "src/App.tsx", ranges: [[8, 8]] },
        ],
      }),
    ).toEqual([]);
  });

  it("keeps a multiline diagnostic when a changed continuation line intersects", () => {
    const diagnostic = buildDiagnostic("src/App.tsx", 2, { endLine: 6 });

    expect(
      filterDiagnosticsByChangedLines({
        directory: "/workspace/project",
        diagnostics: [diagnostic],
        changedLineRanges: [{ file: "src/App.tsx", ranges: [[5, 5]] }],
      }),
    ).toEqual([diagnostic]);
  });

  it("uses the anchor line when the diagnostic end line is absent", () => {
    const diagnostic = buildDiagnostic("src/App.tsx", 2);

    expect(
      filterDiagnosticsByChangedLines({
        directory: "/workspace/project",
        diagnostics: [diagnostic],
        changedLineRanges: [{ file: "src/App.tsx", ranges: [[3, 3]] }],
      }),
    ).toEqual([]);
  });

  it("returns no diagnostics for empty ranges or files without a range entry", () => {
    const diagnostics = [
      buildDiagnostic("src/empty.tsx", 2),
      buildDiagnostic("src/missing.tsx", 2),
    ];

    expect(
      filterDiagnosticsByChangedLines({
        directory: "/workspace/project",
        diagnostics,
        changedLineRanges: [{ file: "src/empty.tsx", ranges: [] }],
      }),
    ).toEqual([]);
  });
});
