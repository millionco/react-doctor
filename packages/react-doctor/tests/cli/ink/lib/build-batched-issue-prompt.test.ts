import { describe, expect, it } from "vitest";
import { buildBatchedIssuePrompt } from "../../../../src/cli/ink/lib/build-batched-issue-prompt.js";
import type { DiagnosticRow } from "../../../../src/cli/ink/lib/diagnostic-rows.js";
import type { Diagnostic } from "@react-doctor/core";

const mockDiagnostic = (overrides: Partial<Diagnostic> = {}): Diagnostic => ({
  plugin: "react-doctor",
  ruleKey: "test-rule",
  severity: "error",
  category: "React",
  title: "Test Issue",
  message: "This is a test issue",
  help: null,
  filePath: "/test/file.tsx",
  line: 10,
  column: 5,
  endLine: 10,
  endColumn: 15,
  fixGroupId: null,
  learnMoreUrl: null,
  ...overrides,
});

const mockRow = (overrides: Partial<DiagnosticRow> = {}): DiagnosticRow => ({
  ruleKey: "test-rule",
  severity: "error",
  category: "React",
  title: "Test Issue",
  siteCount: 1,
  representative: mockDiagnostic(),
  diagnostics: [mockDiagnostic()],
  ...overrides,
});

describe("buildBatchedIssuePrompt", () => {
  it("returns empty string for empty array", () => {
    const result = buildBatchedIssuePrompt({ rows: [], projectName: "test-project" });
    expect(result).toBe("");
  });

  it("generates prompt for single issue", () => {
    const row = mockRow();
    const result = buildBatchedIssuePrompt({ rows: [row], projectName: "test-project" });
    
    expect(result).toContain("Fix 1 React Doctor finding in test-project");
    expect(result).toContain("1. ERROR React: Test Issue (test-rule, ×1)");
    expect(result).toContain("This is a test issue");
    expect(result).toContain("/test/file.tsx:10");
    expect(result).toContain("Verify with `npx react-doctor@latest --verbose`");
  });

  it("generates prompt for multiple issues", () => {
    const row1 = mockRow({
      ruleKey: "rule-one",
      title: "First Issue",
      representative: mockDiagnostic({ ruleKey: "rule-one", title: "First Issue", message: "First message" }),
    });
    const row2 = mockRow({
      ruleKey: "rule-two",
      title: "Second Issue",
      severity: "warning",
      representative: mockDiagnostic({ ruleKey: "rule-two", title: "Second Issue", severity: "warning", message: "Second message" }),
    });
    
    const result = buildBatchedIssuePrompt({ rows: [row1, row2], projectName: "my-app" });
    
    expect(result).toContain("Fix 2 React Doctor findings in my-app");
    expect(result).toContain("1. ERROR React: First Issue (rule-one, ×1)");
    expect(result).toContain("First message");
    expect(result).toContain("2. WARN React: Second Issue (rule-two, ×1)");
    expect(result).toContain("Second message");
    expect(result).toContain("Fix only these rules: rule-one, rule-two");
  });

  it("includes suggested fix when present", () => {
    const row = mockRow({
      representative: mockDiagnostic({ help: "Use useState instead" }),
    });
    
    const result = buildBatchedIssuePrompt({ rows: [row], projectName: "test" });
    expect(result).toContain("Suggested fix: Use useState instead");
  });

  it("shows multiple sites", () => {
    const diagnostics = [
      mockDiagnostic({ filePath: "/test/file1.tsx", line: 10 }),
      mockDiagnostic({ filePath: "/test/file2.tsx", line: 20 }),
      mockDiagnostic({ filePath: "/test/file3.tsx", line: 30 }),
    ];
    const row = mockRow({
      siteCount: 3,
      diagnostics,
    });
    
    const result = buildBatchedIssuePrompt({ rows: [row], projectName: "test" });
    expect(result).toContain("/test/file1.tsx:10");
    expect(result).toContain("/test/file2.tsx:20");
    expect(result).toContain("/test/file3.tsx:30");
  });

  it("includes scope instructions", () => {
    const row = mockRow({ ruleKey: "my-rule" });
    const result = buildBatchedIssuePrompt({ rows: [row], projectName: "test" });
    
    expect(result).toContain("Scope:");
    expect(result).toContain("Fix only these rules: my-rule");
    expect(result).toContain("Fix the root cause for each");
    expect(result).toContain("do not suppress, disable, or silence the rules");
  });
});
