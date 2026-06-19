import { describe, expect, it } from "vite-plus/test";
import { sortDiagnosticsStable } from "../src/utils/sort-diagnostics-stable.js";
import type { Diagnostic } from "@react-doctor/core";

const buildDiagnostic = (overrides: Partial<Diagnostic> = {}): Diagnostic => ({
  filePath: "src/App.tsx",
  plugin: "react-doctor",
  rule: "no-derived-state",
  severity: "warning",
  message: "useState initialized from prop",
  help: "",
  line: 10,
  column: 5,
  category: "State & Effects",
  ...overrides,
});

describe("sortDiagnosticsStable", () => {
  it("orders two diagnostics differing only in severity by string order regardless of input order", () => {
    const errorCopy = buildDiagnostic({ severity: "error" });
    const warningCopy = buildDiagnostic({ severity: "warning" });

    const fromErrorFirst = sortDiagnosticsStable([errorCopy, warningCopy]);
    const fromWarningFirst = sortDiagnosticsStable([warningCopy, errorCopy]);

    expect(fromErrorFirst).toEqual([errorCopy, warningCopy]);
    expect(fromWarningFirst).toEqual([errorCopy, warningCopy]);
    expect(fromErrorFirst).toEqual(fromWarningFirst);
  });

  it("produces a byte-identical ordering for two different permutations of the same set", () => {
    const firstFile = buildDiagnostic({ filePath: "src/a.tsx", line: 3 });
    const sameSiteError = buildDiagnostic({
      filePath: "src/b.tsx",
      line: 7,
      severity: "error",
    });
    const sameSiteWarning = buildDiagnostic({
      filePath: "src/b.tsx",
      line: 7,
      severity: "warning",
    });
    const laterColumn = buildDiagnostic({ filePath: "src/b.tsx", line: 7, column: 42 });
    const lastFile = buildDiagnostic({ filePath: "src/c.tsx", line: 1 });

    const permutationA = [sameSiteWarning, lastFile, firstFile, laterColumn, sameSiteError];
    const permutationB = [laterColumn, firstFile, sameSiteError, lastFile, sameSiteWarning];

    expect(sortDiagnosticsStable(permutationA)).toEqual(sortDiagnosticsStable(permutationB));
  });

  it("breaks ties by line number when earlier fields are equal", () => {
    const earlierLine = buildDiagnostic({ line: 10 });
    const laterLine = buildDiagnostic({ line: 20 });
    expect(sortDiagnosticsStable([laterLine, earlierLine])).toEqual([earlierLine, laterLine]);
  });

  it("breaks ties by column when filePath and line are equal", () => {
    const earlierColumn = buildDiagnostic({ column: 5 });
    const laterColumn = buildDiagnostic({ column: 12 });
    expect(sortDiagnosticsStable([laterColumn, earlierColumn])).toEqual([
      earlierColumn,
      laterColumn,
    ]);
  });

  it("breaks ties by plugin when site is equal", () => {
    const eslintPlugin = buildDiagnostic({ plugin: "eslint-plugin-react-doctor" });
    const oxlintPlugin = buildDiagnostic({ plugin: "oxlint-plugin-react-doctor" });
    expect(sortDiagnosticsStable([oxlintPlugin, eslintPlugin])).toEqual([
      eslintPlugin,
      oxlintPlugin,
    ]);
  });

  it("breaks ties by rule when site and plugin are equal", () => {
    const derivedStateRule = buildDiagnostic({ rule: "no-derived-state" });
    const mirrorPropRule = buildDiagnostic({ rule: "no-mirror-prop-effect" });
    expect(sortDiagnosticsStable([mirrorPropRule, derivedStateRule])).toEqual([
      derivedStateRule,
      mirrorPropRule,
    ]);
  });

  it("breaks ties by message when site / rule / severity are equal", () => {
    const forwardRefMessage = buildDiagnostic({
      rule: "no-react19-deprecated-apis",
      message: "forwardRef is no longer needed on React 19+",
    });
    const useContextMessage = buildDiagnostic({
      rule: "no-react19-deprecated-apis",
      message: "useContext is superseded by `use()`",
    });
    expect(sortDiagnosticsStable([useContextMessage, forwardRefMessage])).toEqual([
      forwardRefMessage,
      useContextMessage,
    ]);
  });

  it("does not mutate the input array and returns a new array", () => {
    const earlierLine = buildDiagnostic({ line: 1 });
    const laterLine = buildDiagnostic({ line: 2 });
    const input = [laterLine, earlierLine];

    const result = sortDiagnosticsStable(input);

    expect(input).toEqual([laterLine, earlierLine]);
    expect(result).not.toBe(input);
    expect(result).toEqual([earlierLine, laterLine]);
  });
});
