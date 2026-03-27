import { describe, expect, it } from "vitest";
import type { Diagnostic, ScoreResult } from "../src/types.js";
import { buildNoBrandingReport } from "../src/utils/no-branding-diagnostics.js";

const createDiagnostic = (overrides: Partial<Diagnostic> = {}): Diagnostic => ({
  filePath: "src/App.tsx",
  plugin: "react",
  rule: "jsx-key",
  severity: "error",
  message: 'Missing "key" prop for element in iterator.',
  help: "Add a unique key prop",
  line: 10,
  column: 5,
  category: "Correctness",
  ...overrides,
});

const createScoreResult = (overrides: Partial<ScoreResult> = {}): ScoreResult => ({
  score: 89,
  label: "Great",
  ...overrides,
});

describe("buildNoBrandingReport", () => {
  it("renders score and label", () => {
    const result = buildNoBrandingReport([], createScoreResult());
    expect(result).toContain("89 / 100");
    expect(result).toContain("Great");
  });

  it("shows N/A when scoreResult is null", () => {
    const result = buildNoBrandingReport([], null);
    expect(result).toContain("N/A");
  });

  it("shows green emoji for score >= 75", () => {
    const result = buildNoBrandingReport([], createScoreResult({ score: 75 }));
    expect(result).toContain("🟢");
  });

  it("shows yellow emoji for score >= 50 and < 75", () => {
    const result = buildNoBrandingReport([], createScoreResult({ score: 60 }));
    expect(result).toContain("🟡");
  });

  it("shows red emoji for score < 50", () => {
    const result = buildNoBrandingReport([], createScoreResult({ score: 30 }));
    expect(result).toContain("🔴");
  });

  it("shows white emoji when score is null", () => {
    const result = buildNoBrandingReport([], null);
    expect(result).toContain("⚪");
  });

  it("shows no issues message for empty diagnostics", () => {
    const result = buildNoBrandingReport([], createScoreResult());
    expect(result).toContain("No issues found");
  });

  it("renders error count", () => {
    const diagnostics = [
      createDiagnostic({ severity: "error" }),
      createDiagnostic({ severity: "error" }),
    ];
    const result = buildNoBrandingReport(diagnostics, createScoreResult());
    expect(result).toContain("<strong>2</strong> errors");
  });

  it("renders warning count", () => {
    const diagnostics = [createDiagnostic({ severity: "warning" })];
    const result = buildNoBrandingReport(diagnostics, createScoreResult());
    expect(result).toContain("<strong>1</strong> warning");
    expect(result).not.toContain("warnings");
  });

  it("renders both errors and warnings", () => {
    const diagnostics = [
      createDiagnostic({ severity: "error" }),
      createDiagnostic({ severity: "warning" }),
    ];
    const result = buildNoBrandingReport(diagnostics, createScoreResult());
    expect(result).toContain("🚨");
    expect(result).toContain("⚠️");
    expect(result).toContain("<strong>1</strong> error");
    expect(result).toContain("<strong>1</strong> warning");
  });

  it("renders a collapsible details section", () => {
    const diagnostics = [createDiagnostic()];
    const result = buildNoBrandingReport(diagnostics, createScoreResult());
    expect(result).toContain("<details>");
    expect(result).toContain("<summary>");
    expect(result).toContain("</details>");
  });

  it("renders diagnostic rows in the table", () => {
    const diagnostics = [
      createDiagnostic({
        plugin: "react",
        rule: "jsx-key",
        message: "Missing key",
        filePath: "src/List.tsx",
        line: 27,
      }),
    ];
    const result = buildNoBrandingReport(diagnostics, createScoreResult());
    expect(result).toContain("<code>react/jsx-key</code>");
    expect(result).toContain("Missing key");
    expect(result).toContain("<code>src/List.tsx:27</code>");
  });

  it("renders table headers", () => {
    const diagnostics = [createDiagnostic()];
    const result = buildNoBrandingReport(diagnostics, createScoreResult());
    expect(result).toContain("<th>Rule</th>");
    expect(result).toContain("<th>Message</th>");
    expect(result).toContain("<th>Location</th>");
  });

  it("uses only HTML tags, no markdown bold syntax", () => {
    const diagnostics = [
      createDiagnostic({ severity: "error" }),
      createDiagnostic({ severity: "warning" }),
    ];
    const result = buildNoBrandingReport(diagnostics, createScoreResult());
    expect(result).not.toMatch(/\*\*\d+\*\*/);
  });

  it("renders multiple diagnostics as separate rows", () => {
    const diagnostics = [
      createDiagnostic({ rule: "jsx-key", line: 10 }),
      createDiagnostic({ rule: "no-danger", line: 20 }),
      createDiagnostic({ rule: "rules-of-hooks", line: 30 }),
    ];
    const result = buildNoBrandingReport(diagnostics, createScoreResult());
    const rowCount = (result.match(/<tr><td>/g) ?? []).length;
    expect(rowCount).toBe(3);
  });

  it("handles score at exact tier boundaries", () => {
    expect(buildNoBrandingReport([], createScoreResult({ score: 75 }))).toContain("🟢");
    expect(buildNoBrandingReport([], createScoreResult({ score: 74 }))).toContain("🟡");
    expect(buildNoBrandingReport([], createScoreResult({ score: 50 }))).toContain("🟡");
    expect(buildNoBrandingReport([], createScoreResult({ score: 49 }))).toContain("🔴");
    expect(buildNoBrandingReport([], createScoreResult({ score: 0 }))).toContain("🔴");
    expect(buildNoBrandingReport([], createScoreResult({ score: 100 }))).toContain("🟢");
  });
});
