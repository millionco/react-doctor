import { describe, expect, it } from "vite-plus/test";
import { DiagnosticSeverity } from "vscode-languageserver";
import type { Diagnostic as CoreDiagnostic } from "@react-doctor/core";
import { toLspDiagnostic } from "../../src/diagnostics/mapper.js";
import {
  SUPPRESS_ALL_CODE_ACTION_KIND,
  buildCodeActions,
} from "../../src/features/code-actions.js";
import type { Diagnostic as LspDiagnostic } from "vscode-languageserver";

const baseDiagnostic = (overrides: Partial<CoreDiagnostic>): CoreDiagnostic => ({
  filePath: "src/App.tsx",
  plugin: "react-doctor",
  rule: "no-array-index-key",
  severity: "warning",
  message: "msg",
  help: "help",
  line: 1,
  column: 1,
  category: "Performance",
  ...overrides,
});

describe("severity demotion", () => {
  it("keeps a normal warning at Warning severity", () => {
    const mapped = toLspDiagnostic({
      diagnostic: baseDiagnostic({ rule: "no-array-index-key", severity: "warning" }),
      fsPath: "/repo/src/App.tsx",
      text: null,
    });
    expect(mapped.severity).toBe(DiagnosticSeverity.Warning);
  });

  it("keeps an error at Error severity", () => {
    const mapped = toLspDiagnostic({
      diagnostic: baseDiagnostic({ rule: "no-array-index-key", severity: "error" }),
      fsPath: "/repo/src/App.tsx",
      text: null,
    });
    expect(mapped.severity).toBe(DiagnosticSeverity.Error);
  });

  it("demotes a design-tagged rule to Information", () => {
    const mapped = toLspDiagnostic({
      diagnostic: baseDiagnostic({ rule: "design-no-em-dash-in-jsx-text", severity: "warning" }),
      fsPath: "/repo/src/App.tsx",
      text: null,
    });
    expect(mapped.severity).toBe(DiagnosticSeverity.Information);
  });
});

describe("file-level suppress action kind", () => {
  it("uses a namespaced source kind, not the bare `source` kind", () => {
    const lspDiagnostic: LspDiagnostic = toLspDiagnostic({
      diagnostic: baseDiagnostic({ line: 9, column: 13 }),
      fsPath: "/repo/src/App.tsx",
      text: "a\nb\nc\nd\ne\nf\ng\nh\n  <li key={i} />\n",
    });
    const actions = buildCodeActions({
      uri: "file:///repo/src/App.tsx",
      fsPath: "/repo/src/App.tsx",
      documentText: "a\nb\nc\nd\ne\nf\ng\nh\n  <li key={i} />\n",
      relativeFilePath: "src/App.tsx",
      rangeDiagnostics: [lspDiagnostic],
      fileDiagnostics: [lspDiagnostic],
    });
    const suppressAll = actions.find((action) =>
      action.title.includes("Suppress all React Doctor issues"),
    );
    expect(suppressAll?.kind).toBe(SUPPRESS_ALL_CODE_ACTION_KIND);
    expect(SUPPRESS_ALL_CODE_ACTION_KIND).toBe("source.suppressAll.reactDoctor");
    expect(suppressAll?.kind).not.toBe("source");
  });
});
