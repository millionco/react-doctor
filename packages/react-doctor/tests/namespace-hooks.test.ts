import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import type { Diagnostic } from "../src/types/diagnostic.js";
import { runOxlint } from "../src/core/run-oxlint.js";
import { buildTestProject } from "./regressions/_helpers.js";

const FIXTURES_DIRECTORY = path.resolve(import.meta.dirname, "fixtures");
const BASIC_REACT_DIRECTORY = path.join(FIXTURES_DIRECTORY, "basic-react");

const findDiagnosticsInFile = (
  diagnostics: Diagnostic[],
  rule: string,
  fileFragment: string,
): Diagnostic[] =>
  diagnostics.filter(
    (diagnostic) => diagnostic.rule === rule && diagnostic.filePath.includes(fileFragment),
  );

let diagnostics: Diagnostic[];

describe("namespace hook detection (React.useEffect, React.useState, etc.)", () => {
  it("loads diagnostics from namespace-hooks fixture", async () => {
    diagnostics = await runOxlint({
      rootDirectory: BASIC_REACT_DIRECTORY,
      project: buildTestProject({
        rootDirectory: BASIC_REACT_DIRECTORY,
        hasTanStackQuery: true,
      }),
    });
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("detects no-derived-state-effect with React.useEffect", () => {
    const issues = findDiagnosticsInFile(diagnostics, "no-derived-state-effect", "namespace-hooks");
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].message).toContain("Derived state in useEffect");
  });

  it("detects no-fetch-in-effect with React.useEffect", () => {
    const issues = findDiagnosticsInFile(diagnostics, "no-fetch-in-effect", "namespace-hooks");
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].message).toContain("fetch() inside useEffect");
  });

  it("detects no-cascading-set-state with React.useEffect", () => {
    const issues = findDiagnosticsInFile(diagnostics, "no-cascading-set-state", "namespace-hooks");
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].message).toContain("setState calls in a single useEffect");
  });

  it("detects no-effect-event-handler with React.useEffect", () => {
    const issues = findDiagnosticsInFile(diagnostics, "no-effect-event-handler", "namespace-hooks");
    expect(issues.length).toBeGreaterThan(0);
  });

  it("detects no-derived-useState with React.useState", () => {
    const issues = findDiagnosticsInFile(diagnostics, "no-derived-useState", "namespace-hooks");
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].message).toContain("initialName");
  });

  it("detects rerender-lazy-state-init with React.useState", () => {
    const issues = findDiagnosticsInFile(
      diagnostics,
      "rerender-lazy-state-init",
      "namespace-hooks",
    );
    expect(issues.length).toBeGreaterThan(0);
  });

  it("detects rerender-functional-setstate with React.useState setter", () => {
    const issues = findDiagnosticsInFile(
      diagnostics,
      "rerender-functional-setstate",
      "namespace-hooks",
    );
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].message).toContain("use functional update");
  });

  it("detects rerender-dependencies with React.useEffect and React.useCallback", () => {
    const issues = findDiagnosticsInFile(diagnostics, "rerender-dependencies", "namespace-hooks");
    expect(issues.length).toBeGreaterThan(0);
  });

  it("detects rendering-hydration-no-flicker with React.useEffect", () => {
    const issues = findDiagnosticsInFile(
      diagnostics,
      "rendering-hydration-no-flicker",
      "namespace-hooks",
    );
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].message).toContain("useEffect(setState, [])");
  });

  it("detects no-usememo-simple-expression with React.useMemo", () => {
    const issues = findDiagnosticsInFile(
      diagnostics,
      "no-usememo-simple-expression",
      "namespace-hooks",
    );
    expect(issues.length).toBeGreaterThan(0);
  });

  it("detects prefer-useReducer with React.useState", () => {
    const issues = findDiagnosticsInFile(diagnostics, "prefer-useReducer", "namespace-hooks");
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].message).toContain("useState calls");
  });

  it("does not flag member expression calls like localStorage.setItem as state setters", () => {
    const allCleanFileIssues = diagnostics.filter((diagnostic) =>
      diagnostic.filePath.includes("clean"),
    );

    const setterRules = new Set([
      "no-derived-state-effect",
      "no-cascading-set-state",
      "rerender-functional-setstate",
      "rendering-hydration-no-flicker",
    ]);

    const falsePositives = allCleanFileIssues.filter((diagnostic) =>
      setterRules.has(diagnostic.rule),
    );
    expect(
      falsePositives,
      "member expression calls like localStorage.setItem should not be flagged as React state setters",
    ).toHaveLength(0);
  });

  it("still detects all rules from direct-import fixtures (no regression)", () => {
    const directImportRules = [
      "no-derived-state-effect",
      "no-fetch-in-effect",
      "no-cascading-set-state",
      "no-effect-event-handler",
      "no-derived-useState",
      "rerender-lazy-state-init",
      "rerender-functional-setstate",
      "rerender-dependencies",
    ];

    for (const rule of directImportRules) {
      const stateIssues = findDiagnosticsInFile(diagnostics, rule, "state-issues");
      expect(
        stateIssues.length,
        `expected ${rule} to still fire on state-issues.tsx`,
      ).toBeGreaterThan(0);
    }
  });
});
