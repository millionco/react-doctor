import { describe, expect, it, vi } from "vite-plus/test";
import { buildDiagnosticPipeline, evaluateSuppression } from "@react-doctor/core";
import type { Diagnostic } from "@react-doctor/core";

const noEvalDiagnostic: Diagnostic = {
  filePath: "src/run.ts",
  plugin: "react-doctor",
  rule: "no-eval",
  severity: "error",
  message: "eval() is a code-injection vulnerability.",
  help: "",
  line: 2,
  column: 1,
  category: "Security",
};

describe("buildDiagnosticPipeline — foreign disable near-miss hint wiring", () => {
  it("stamps a suppressionHint on a firing diagnostic whose eslint-disable used the bare name", () => {
    const pipeline = buildDiagnosticPipeline({
      rootDirectory: "/repo",
      userConfig: null,
      respectInlineDisables: true,
      showWarnings: true,
      readFileLinesSync: () => ["// eslint-disable-next-line no-eval", "eval(code);"],
    });

    const result = pipeline.apply(noEvalDiagnostic);

    expect(result).not.toBeNull();
    expect(result?.suppressionHint).toContain("react-doctor/no-eval");
  });

  it("leaves the diagnostic untouched when the canonical name was used (oxlint already handles it)", () => {
    const pipeline = buildDiagnosticPipeline({
      rootDirectory: "/repo",
      userConfig: null,
      respectInlineDisables: true,
      showWarnings: true,
      readFileLinesSync: () => ["// eslint-disable-next-line react-doctor/no-eval", "eval(code);"],
    });

    const result = pipeline.apply(noEvalDiagnostic);

    expect(result?.suppressionHint).toBeUndefined();
  });

  it("stamps a hint for a file-level block disable that used the bare name", () => {
    const pipeline = buildDiagnosticPipeline({
      rootDirectory: "/repo",
      userConfig: null,
      respectInlineDisables: true,
      showWarnings: true,
      readFileLinesSync: () => ["/* eslint-disable no-eval */", "const a = 1;", "eval(code);"],
    });

    const result = pipeline.apply({ ...noEvalDiagnostic, line: 3 });

    expect(result?.suppressionHint).toContain("react-doctor/no-eval");
  });

  it("drops the diagnostic when react-doctor-disable used the bare short id", () => {
    const pipeline = buildDiagnosticPipeline({
      rootDirectory: "/repo",
      userConfig: null,
      respectInlineDisables: true,
      showWarnings: true,
      readFileLinesSync: () => ["// react-doctor-disable-next-line no-eval", "eval(code);"],
    });

    expect(pipeline.apply(noEvalDiagnostic)).toBeNull();
  });
  it("does linear source work for dense files without disable markers", () => {
    const sourceLines = Array.from({ length: 1000 }, () => "eval(code);");
    let sourceLineReads = 0;
    const snapshot = new Proxy(sourceLines, {
      get: (target, property, receiver) => {
        if (typeof property === "string" && /^\d+$/.test(property)) sourceLineReads += 1;
        return Reflect.get(target, property, receiver);
      },
    });
    const readFileLinesSync = vi.fn(() => snapshot);
    const pipeline = buildDiagnosticPipeline({
      rootDirectory: "/repo",
      userConfig: null,
      respectInlineDisables: true,
      showWarnings: true,
      readFileLinesSync,
    });
    const diagnostics = sourceLines.map((_, diagnosticIndex) => ({
      ...noEvalDiagnostic,
      line: diagnosticIndex + 1,
    }));
    expect(diagnostics.map(pipeline.apply)).toEqual(diagnostics);
    expect(readFileLinesSync).toHaveBeenCalledTimes(1);
    expect(sourceLineReads).toBeLessThanOrEqual(sourceLines.length + diagnostics.length);
  });

  it("preserves foreign disable and enable ranges after admitting a source snapshot", () => {
    const pipeline = buildDiagnosticPipeline({
      rootDirectory: "/repo",
      userConfig: null,
      respectInlineDisables: true,
      showWarnings: true,
      readFileLinesSync: () => [
        "/* eslint-disable no-eval */",
        "eval(code);",
        "/* eslint-enable no-eval */",
        "eval(code);",
      ],
    });
    expect(pipeline.apply(noEvalDiagnostic)?.suppressionHint).toContain("react-doctor/no-eval");
    expect(pipeline.apply({ ...noEvalDiagnostic, line: 4 })?.suppressionHint).toBeUndefined();
  });

  it("keeps marker-free and directive-bearing file snapshots independent", () => {
    const readFileLinesSync = vi.fn((filePath: string) =>
      filePath.endsWith("empty.ts")
        ? ["const value = 1;", "eval(code);"]
        : ["// react-doctor-disable-next-line no-eval", "eval(code);"],
    );
    const pipeline = buildDiagnosticPipeline({
      rootDirectory: "/repo",
      userConfig: null,
      respectInlineDisables: true,
      showWarnings: true,
      readFileLinesSync,
    });
    const markerFreeDiagnostic = { ...noEvalDiagnostic, filePath: "src/empty.ts" };
    const disabledDiagnostic = { ...noEvalDiagnostic, filePath: "src/disabled.ts" };
    expect(pipeline.apply(markerFreeDiagnostic)).toEqual(markerFreeDiagnostic);
    expect(pipeline.apply(disabledDiagnostic)).toBeNull();
    expect(pipeline.apply(markerFreeDiagnostic)).toEqual(markerFreeDiagnostic);
    expect(readFileLinesSync).toHaveBeenCalledTimes(2);
  });

  it("retains React Compiler foreign-directive suppression attribution", () => {
    const pipeline = buildDiagnosticPipeline({
      rootDirectory: "/repo",
      userConfig: null,
      respectInlineDisables: true,
      showWarnings: true,
      readFileLinesSync: () => ["// eslint-disable-next-line react-hooks/refs", "ref.current;"],
    });
    const diagnostic = { ...noEvalDiagnostic, plugin: "react-hooks-js", rule: "refs" };
    expect(pipeline.apply(diagnostic)).toBeNull();
    expect(pipeline.summarizeSuppressions()).toEqual([
      { rule: "react-hooks-js/refs", source: "foreign-inline", count: 1 },
    ]);
  });

  it.each([
    { name: "custom text component", config: { textComponents: ["MyText"] } },
    { name: "string-only wrapper", config: { rawTextWrapperComponents: ["MyText"] } },
  ])("preserves $name exemptions after marker-free suppression checks", ({ config }) => {
    const readFileLinesSync = vi.fn(() => ["<MyText>", "  hello", "</MyText>"]);
    const pipeline = buildDiagnosticPipeline({
      rootDirectory: "/repo",
      userConfig: config,
      respectInlineDisables: true,
      showWarnings: true,
      readFileLinesSync,
    });
    const ordinaryDiagnostic = { ...noEvalDiagnostic, filePath: "src/view.tsx" };
    expect(pipeline.apply(ordinaryDiagnostic)).toEqual(ordinaryDiagnostic);
    expect(
      pipeline.apply({
        ...ordinaryDiagnostic,
        rule: "rn-no-raw-text",
        category: "Bugs",
        column: 3,
      }),
    ).toBeNull();
    expect(readFileLinesSync).toHaveBeenCalledTimes(1);
  });

  it("preserves shebang exemptions after marker-free suppression checks", () => {
    const readFileLinesSync = vi.fn((filePath: string) =>
      filePath.endsWith("entry.mjs")
        ? ["#!/usr/bin/env node", 'console.log("ok");']
        : ['console.log("browser");'],
    );
    const pipeline = buildDiagnosticPipeline({
      rootDirectory: "/repo",
      userConfig: null,
      respectInlineDisables: true,
      showWarnings: true,
      readFileLinesSync,
    });
    const ordinaryDiagnostic = { ...noEvalDiagnostic, filePath: "src/entry.mjs" };
    expect(pipeline.apply(ordinaryDiagnostic)).toEqual(ordinaryDiagnostic);
    expect(
      pipeline.apply({ ...ordinaryDiagnostic, plugin: "eslint", rule: "no-console" }),
    ).toBeNull();
    const browserDiagnostic = {
      ...noEvalDiagnostic,
      filePath: "src/browser.mjs",
      plugin: "eslint",
      rule: "no-console",
      line: 1,
    };
    expect(pipeline.apply(browserDiagnostic)).toEqual(browserDiagnostic);
    expect(readFileLinesSync).toHaveBeenCalledTimes(2);
  });

  it.each([
    { name: "uppercase directive", source: "// ESLINT-DISABLE-NEXT-LINE no-eval" },
    { name: "spaced marker", source: "// eslint- disable-next-line no-eval" },
    { name: "accepted tool spacing", source: "// \t eslint-disable-next-line no-eval" },
    { name: "accepted own spacing", source: "//   react-doctor-disable-next-line no-eval" },
    { name: "accepted block spacing", source: "/* \t oxlint-disable no-eval */" },
    { name: "ordinary marker string", source: 'const note = "-disable";' },
    { name: "directive-like string", source: 'const note = "/* eslint-disable no-eval */";' },
  ])("keeps original suppression semantics for a $name", ({ source }) => {
    const lines = [source, "eval(code);"];
    const expected = evaluateSuppression(lines, 1, "react-doctor/no-eval");
    const pipeline = buildDiagnosticPipeline({
      rootDirectory: "/repo",
      userConfig: null,
      respectInlineDisables: true,
      showWarnings: true,
      readFileLinesSync: () => lines,
    });
    const actual = pipeline.apply(noEvalDiagnostic);
    expect(actual === null).toBe(expected.isSuppressed);
    expect(actual?.suppressionHint ?? null).toBe(expected.nearMissHint);
  });
});
