import { describe, expect, it } from "vite-plus/test";
import { DiagnosticSeverity } from "vscode-languageserver";
import { severityLabel } from "../../src/utils/severity-label.js";

describe("severityLabel", () => {
  it("maps all four LSP severities (not just error/warning)", () => {
    expect(severityLabel(DiagnosticSeverity.Error)).toBe("error");
    expect(severityLabel(DiagnosticSeverity.Warning)).toBe("warning");
    expect(severityLabel(DiagnosticSeverity.Information)).toBe("info");
    expect(severityLabel(DiagnosticSeverity.Hint)).toBe("hint");
  });

  it("falls back to warning for an undefined severity", () => {
    expect(severityLabel(undefined)).toBe("warning");
  });
});
