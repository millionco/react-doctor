import { describe, expect, it } from "vite-plus/test";
import { buildDiagnosticIdentity } from "@react-doctor/core";
import type { Diagnostic as CoreDiagnostic } from "@react-doctor/core";
import { DiagnosticSeverity, DiagnosticTag } from "vscode-languageserver";
import { toLspDiagnostic } from "../../src/diagnostics/mapper.js";

const FS_PATH = "/repo/src/App.tsx";

const makeDiagnostic = (overrides: Partial<CoreDiagnostic> = {}): CoreDiagnostic => ({
  filePath: FS_PATH,
  plugin: "react-doctor",
  rule: "no-array-index-key",
  severity: "warning",
  message: "Avoid using the array index as a key",
  help: "Use a stable, unique identifier",
  line: 9,
  column: 13,
  category: "Correctness",
  ...overrides,
});

describe("toLspDiagnostic", () => {
  it("derives a precise range from a byte span and maps error severity", () => {
    const text = "const greeting = 1;";
    const offset = "const ".length;
    const diagnostic = makeDiagnostic({ severity: "error", offset, length: "greeting".length });
    const result = toLspDiagnostic({ diagnostic, fsPath: FS_PATH, text });

    expect(result.severity).toBe(DiagnosticSeverity.Error);
    expect(result.code).toBe("react-doctor/no-array-index-key");
    expect(result.source).toBe("react-doctor");
    expect(result.range.start).toEqual({ line: 0, character: offset });
    expect(result.range.end.character).toBeGreaterThan(result.range.start.character);
    expect(result.tags).toBeUndefined();
    expect(result.codeDescription).toBeUndefined();
  });

  it("falls back to 1-indexed line/column when no byte offset is present", () => {
    const diagnostic = makeDiagnostic({ line: 9, column: 13 });
    const result = toLspDiagnostic({ diagnostic, fsPath: FS_PATH, text: null });

    expect(result.severity).toBe(DiagnosticSeverity.Warning);
    expect(result.range.start).toEqual({ line: 8, character: 12 });
    expect(result.range.end).toEqual({ line: 8, character: 13 });
  });

  it("tags dead-code diagnostics as Unnecessary and sets codeDescription from url", () => {
    const diagnostic = makeDiagnostic({
      category: "Dead Code",
      rule: "no-unused-file",
      url: "https://www.react.doctor/rules/no-unused-file",
    });
    const result = toLspDiagnostic({ diagnostic, fsPath: FS_PATH, text: null });

    expect(result.tags).toEqual([DiagnosticTag.Unnecessary]);
    expect(result.codeDescription).toEqual({
      href: "https://www.react.doctor/rules/no-unused-file",
    });
  });

  it("maps related locations into relatedInformation", () => {
    const diagnostic = makeDiagnostic({
      relatedLocations: [{ filePath: FS_PATH, line: 4, column: 5, message: "prop declared here" }],
    });
    const result = toLspDiagnostic({ diagnostic, fsPath: FS_PATH, text: null });

    expect(result.relatedInformation).toHaveLength(1);
    expect(result.relatedInformation?.[0].message).toBe("prop declared here");
    expect(result.relatedInformation?.[0].location.uri).toContain("App.tsx");
    expect(result.relatedInformation?.[0].location.range.start).toEqual({ line: 3, character: 4 });
  });

  it("attaches a structured data payload for the hover / code-action handlers", () => {
    const diagnostic = makeDiagnostic({
      url: "https://www.react.doctor/rules/no-array-index-key",
      suppressionHint: "// react-doctor-disable-next-line no-array-index-key",
    });
    const result = toLspDiagnostic({ diagnostic, fsPath: FS_PATH, text: null });

    expect(result.data).toMatchObject({
      identity: buildDiagnosticIdentity({
        filePath: FS_PATH,
        line: 9,
        column: 13,
        plugin: "react-doctor",
        rule: "no-array-index-key",
      }),
      plugin: "react-doctor",
      rule: "no-array-index-key",
      ruleId: "react-doctor/no-array-index-key",
      category: "Correctness",
      help: "Use a stable, unique identifier",
      url: "https://www.react.doctor/rules/no-array-index-key",
      suppressionHint: "// react-doctor-disable-next-line no-array-index-key",
      line: 9,
      column: 13,
      fsPath: FS_PATH,
    });
  });

  it("nulls out optional data fields when absent", () => {
    const result = toLspDiagnostic({ diagnostic: makeDiagnostic(), fsPath: FS_PATH, text: null });
    expect(result.data).toMatchObject({ url: null, suppressionHint: null });
  });
});
