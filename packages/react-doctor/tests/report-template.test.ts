import { describe, expect, it } from "vitest";
import type { Diagnostic, ReportPayload } from "../src/types.js";
import { buildReportHtml } from "../src/utils/report-template.js";

const createDiagnostic = (overrides: Partial<Diagnostic> = {}): Diagnostic => ({
  filePath: "src/App.tsx",
  plugin: "basic-react",
  rule: "no-danger",
  severity: "error",
  message: "Avoid using dangerouslySetInnerHTML.",
  help: "Use a sanitization library or render text instead.",
  line: 10,
  column: 5,
  category: "Security",
  ...overrides,
});

describe("buildReportHtml", () => {
  it("includes document structure and React Doctor header", () => {
    const payload: ReportPayload = {
      diagnostics: [],
      score: null,
      label: null,
      projectName: "test-project",
    };
    const html = buildReportHtml(payload);
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<title>test-project \u2014 React Doctor</title>");
    expect(html).toContain("<h1>React Doctor</h1>");
    expect(html).toContain("www.react.doctor");
  });

  it("includes score section when score is present", () => {
    const payload: ReportPayload = {
      diagnostics: [],
      score: 85,
      label: "Great",
      projectName: "my-app",
    };
    const html = buildReportHtml(payload);
    expect(html).toContain("85");
    expect(html).toContain("/ 100");
    expect(html).toContain("Great");
    expect(html).toContain("score-bar-fill");
  });

  it("shows score unavailable when score is null", () => {
    const payload: ReportPayload = {
      diagnostics: [createDiagnostic()],
      score: null,
      label: null,
      projectName: "offline-run",
    };
    const html = buildReportHtml(payload);
    expect(html).toContain("Score unavailable");
    expect(html).toContain("score-unavailable");
  });

  it("includes summary counts for errors and warnings", () => {
    const payload: ReportPayload = {
      diagnostics: [
        createDiagnostic({ severity: "error" }),
        createDiagnostic({ severity: "error" }),
        createDiagnostic({ severity: "warning" }),
      ],
      score: 70,
      label: "Needs work",
      projectName: "counts-test",
    };
    const html = buildReportHtml(payload);
    expect(html).toContain("2 errors");
    expect(html).toContain("1 warning");
  });

  it("includes diagnostic groups with rule key, message, help, and locations", () => {
    const payload: ReportPayload = {
      diagnostics: [
        createDiagnostic({
          message: "Avoid using dangerouslySetInnerHTML.",
          help: "Use a sanitization library.",
          filePath: "src/App.tsx",
          line: 10,
        }),
      ],
      score: null,
      label: null,
      projectName: "diagnostics-test",
    };
    const html = buildReportHtml(payload);
    expect(html).toContain("Avoid using dangerouslySetInnerHTML.");
    expect(html).toContain("Use a sanitization library.");
    expect(html).toContain("basic-react/no-danger");
    expect(html).toContain("src/App.tsx");
    expect(html).toContain(":10");
  });

  it("escapes HTML in diagnostic message and help", () => {
    const payload: ReportPayload = {
      diagnostics: [
        createDiagnostic({
          message: "Message with <script>alert(1)</script> tags",
          help: 'Help with "quotes" and <b>HTML</b>',
        }),
      ],
      score: null,
      label: null,
      projectName: "escape-test",
    };
    const html = buildReportHtml(payload);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&quot;quotes&quot;");
    expect(html).toContain("&lt;b&gt;HTML&lt;/b&gt;");
  });

  it("groups multiple diagnostics by plugin/rule and shows count", () => {
    const payload: ReportPayload = {
      diagnostics: [
        createDiagnostic({ filePath: "src/A.tsx", line: 1 }),
        createDiagnostic({ filePath: "src/B.tsx", line: 2 }),
      ],
      score: 50,
      label: "Needs work",
      projectName: "group-test",
    };
    const html = buildReportHtml(payload);
    expect(html).toContain("(2)");
    expect(html).toContain("src/A.tsx");
    expect(html).toContain("src/B.tsx");
  });
});
