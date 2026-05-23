import { describe, expect, it } from "vite-plus/test";
import { dedupeDiagnostics } from "@react-doctor/core";
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

describe("dedupeDiagnostics", () => {
  it("returns an empty array for an empty input", () => {
    expect(dedupeDiagnostics([])).toEqual([]);
  });

  it("preserves a single diagnostic unchanged", () => {
    const single = buildDiagnostic();
    expect(dedupeDiagnostics([single])).toEqual([single]);
  });

  it("collapses exact duplicates (same file / line / column / plugin / rule / message / severity)", () => {
    const original = buildDiagnostic();
    const exactCopy = buildDiagnostic();
    const result = dedupeDiagnostics([original, exactCopy, exactCopy]);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(original);
  });

  it("preserves diagnostics that differ in line number", () => {
    const first = buildDiagnostic({ line: 10 });
    const second = buildDiagnostic({ line: 20 });
    expect(dedupeDiagnostics([first, second])).toEqual([first, second]);
  });

  it("preserves diagnostics that differ in column", () => {
    const first = buildDiagnostic({ column: 5 });
    const second = buildDiagnostic({ column: 12 });
    expect(dedupeDiagnostics([first, second])).toEqual([first, second]);
  });

  it("preserves diagnostics with different rules at the same location", () => {
    const stateRule = buildDiagnostic({ rule: "no-derived-state" });
    const mirrorRule = buildDiagnostic({ rule: "no-mirror-prop-effect" });
    expect(dedupeDiagnostics([stateRule, mirrorRule])).toEqual([stateRule, mirrorRule]);
  });

  it("preserves diagnostics with different messages at the same location and rule", () => {
    const useContextMessage = buildDiagnostic({
      rule: "no-react19-deprecated-apis",
      message: "useContext is superseded by `use()`",
    });
    const forwardRefMessage = buildDiagnostic({
      rule: "no-react19-deprecated-apis",
      message: "forwardRef is no longer needed on React 19+",
    });
    expect(dedupeDiagnostics([useContextMessage, forwardRefMessage])).toEqual([
      useContextMessage,
      forwardRefMessage,
    ]);
  });

  it("preserves diagnostics that differ only in severity", () => {
    // HACK: severity differing at the same location should be a real
    // signal (config drift, escalation policy), not a duplicate.
    const warningCopy = buildDiagnostic({ severity: "warning" });
    const errorCopy = buildDiagnostic({ severity: "error" });
    expect(dedupeDiagnostics([warningCopy, errorCopy])).toEqual([warningCopy, errorCopy]);
  });

  it("preserves diagnostic ordering for unique entries", () => {
    const a = buildDiagnostic({ line: 1 });
    const b = buildDiagnostic({ line: 2 });
    const c = buildDiagnostic({ line: 3 });
    expect(dedupeDiagnostics([c, a, b, a, c])).toEqual([c, a, b]);
  });

  it("ignores derived fields (help / url / category) when keying", () => {
    // HACK: help/url/category are deterministically derived from
    // (plugin, rule). If a future refactor accidentally produces two
    // diagnostics that disagree on `help` for the same (plugin, rule,
    // line), they're still the same diagnostic — dedupe should collapse
    // them and keep the first.
    const withHelp = buildDiagnostic({ help: "fix me one way" });
    const withDifferentHelp = buildDiagnostic({ help: "fix me a different way" });
    const result = dedupeDiagnostics([withHelp, withDifferentHelp]);
    expect(result).toHaveLength(1);
    expect(result[0].help).toBe("fix me one way");
  });
});
