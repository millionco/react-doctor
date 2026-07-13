import { describe, expect, it } from "vite-plus/test";
import { dedupeDiagnostics } from "@react-doctor/core";
import type { Diagnostic } from "@react-doctor/core";
import { dedupeRelatedDiagnostics } from "../src/utils/dedupe-related-diagnostics.js";

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

const buildNativeHookDiagnostic = (overrides: Partial<Diagnostic> = {}): Diagnostic =>
  buildDiagnostic({
    rule: "rules-of-hooks",
    message: "React Hook is called conditionally",
    ...overrides,
  });

const buildCompilerHookDiagnostic = (overrides: Partial<Diagnostic> = {}): Diagnostic =>
  buildDiagnostic({
    plugin: "react-hooks-js",
    rule: "hooks",
    message: "Hooks must always be called in a consistent order",
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

  it("preserves overlapping related derived-state rules (cross-rule collapse happens post-pipeline)", () => {
    const generic = buildDiagnostic({ rule: "no-derived-state", offset: 100, length: 12 });
    const propChange = buildDiagnostic({
      rule: "no-adjust-state-on-prop-change",
      offset: 100,
      length: 12,
    });
    expect(dedupeDiagnostics([generic, propChange])).toEqual([generic, propChange]);
  });

  it("keeps the React Doctor rules-of-hooks diagnostic when the compiler reports the same site", () => {
    const reactDoctorDiagnostic = buildNativeHookDiagnostic();
    const compilerDiagnostic = buildCompilerHookDiagnostic();

    expect(dedupeRelatedDiagnostics([compilerDiagnostic, reactDoctorDiagnostic])).toEqual([
      reactDoctorDiagnostic,
    ]);
    expect(dedupeRelatedDiagnostics([reactDoctorDiagnostic, compilerDiagnostic])).toEqual([
      reactDoctorDiagnostic,
    ]);
  });

  it("preserves compiler Hook findings at a nearby distinct site", () => {
    const reactDoctorDiagnostic = buildNativeHookDiagnostic({ column: 5 });
    const compilerDiagnostic = buildCompilerHookDiagnostic({ column: 20 });

    expect(dedupeRelatedDiagnostics([reactDoctorDiagnostic, compilerDiagnostic])).toEqual([
      reactDoctorDiagnostic,
      compilerDiagnostic,
    ]);
  });

  it("preserves standalone compiler Hook findings", () => {
    const compilerDiagnostic = buildCompilerHookDiagnostic();

    expect(dedupeRelatedDiagnostics([compilerDiagnostic])).toEqual([compilerDiagnostic]);
  });

  it("preserves native Hook findings when the compiler is disabled", () => {
    const reactDoctorDiagnostic = buildNativeHookDiagnostic();

    expect(dedupeRelatedDiagnostics([reactDoctorDiagnostic])).toEqual([reactDoctorDiagnostic]);
  });

  it("preserves unrelated compiler diagnostics at the same site", () => {
    const reactDoctorDiagnostic = buildNativeHookDiagnostic();
    const compilerDiagnostic = buildDiagnostic({
      plugin: "react-hooks-js",
      rule: "set-state-in-effect",
      message: "Calling setState synchronously within an effect can trigger cascading renders",
    });

    expect(dedupeRelatedDiagnostics([reactDoctorDiagnostic, compilerDiagnostic])).toEqual([
      reactDoctorDiagnostic,
      compilerDiagnostic,
    ]);
  });

  it("preserves compiler Hook findings in a different file at the same position", () => {
    const reactDoctorDiagnostic = buildNativeHookDiagnostic();
    const compilerDiagnostic = buildCompilerHookDiagnostic({ filePath: "src/Other.tsx" });

    expect(dedupeRelatedDiagnostics([reactDoctorDiagnostic, compilerDiagnostic])).toEqual([
      reactDoctorDiagnostic,
      compilerDiagnostic,
    ]);
  });

  it("preserves compiler Hook findings on a different line at the same column", () => {
    const reactDoctorDiagnostic = buildNativeHookDiagnostic({ line: 10 });
    const compilerDiagnostic = buildCompilerHookDiagnostic({ line: 20 });

    expect(dedupeRelatedDiagnostics([reactDoctorDiagnostic, compilerDiagnostic])).toEqual([
      reactDoctorDiagnostic,
      compilerDiagnostic,
    ]);
  });

  it("keeps the most specific derived-state owner at one write", () => {
    const generic = buildDiagnostic({ rule: "no-derived-state", offset: 100, length: 12 });
    const effect = buildDiagnostic({
      rule: "no-derived-state-effect",
      offset: 80,
      length: 60,
    });
    const propChange = buildDiagnostic({
      rule: "no-adjust-state-on-prop-change",
      offset: 100,
      length: 12,
    });
    expect(dedupeRelatedDiagnostics([effect, generic, propChange])).toEqual([propChange]);
  });

  it("keeps mount initialization ahead of generic derived-state rules", () => {
    const generic = buildDiagnostic({ rule: "no-derived-state", offset: 100, length: 12 });
    const mount = buildDiagnostic({ rule: "no-initialize-state", offset: 100, length: 12 });
    expect(dedupeRelatedDiagnostics([generic, mount])).toEqual([mount]);
  });

  it("carries an escalated error severity onto the surviving derived-state winner", () => {
    const escalatedFallback = buildDiagnostic({
      rule: "no-derived-state",
      severity: "error",
      offset: 100,
      length: 12,
    });
    const preferredWarning = buildDiagnostic({
      rule: "no-adjust-state-on-prop-change",
      severity: "warning",
      offset: 100,
      length: 12,
    });
    const expected = [{ ...preferredWarning, severity: "error" }];
    expect(dedupeRelatedDiagnostics([escalatedFallback, preferredWarning])).toEqual(expected);
    expect(dedupeRelatedDiagnostics([preferredWarning, escalatedFallback])).toEqual(expected);
  });

  it("keeps the winner's severity when the collapsed sibling is not escalated", () => {
    const fallbackWarning = buildDiagnostic({
      rule: "no-derived-state",
      severity: "warning",
      offset: 100,
      length: 12,
    });
    const preferredError = buildDiagnostic({
      rule: "no-adjust-state-on-prop-change",
      severity: "error",
      offset: 100,
      length: 12,
    });
    expect(dedupeRelatedDiagnostics([fallbackWarning, preferredError])).toEqual([preferredError]);
    expect(dedupeRelatedDiagnostics([preferredError, fallbackWarning])).toEqual([preferredError]);
  });

  it("preserves separate writes inside one overlapping effect diagnostic", () => {
    const effect = buildDiagnostic({
      rule: "no-derived-state-effect",
      offset: 80,
      length: 100,
    });
    const firstWrite = buildDiagnostic({
      rule: "no-adjust-state-on-prop-change",
      offset: 100,
      length: 12,
    });
    const secondWrite = buildDiagnostic({
      rule: "no-adjust-state-on-prop-change",
      offset: 140,
      length: 12,
      column: 20,
    });
    expect(dedupeRelatedDiagnostics([effect, firstWrite, secondWrite])).toEqual([
      firstWrite,
      secondWrite,
    ]);
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
