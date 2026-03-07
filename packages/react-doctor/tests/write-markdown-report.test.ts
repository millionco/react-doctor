import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Diagnostic, MarkdownReportData } from "../src/types.js";
import { writeMarkdownReport } from "../src/utils/write-markdown-report.js";

const temporaryDirectories: string[] = [];
const DEFAULT_LINE_NUMBER = 12;
const SECOND_DIAGNOSTIC_LINE_NUMBER = 18;
const DEFAULT_COLUMN_NUMBER = 4;
const PROJECT_SOURCE_FILE_COUNT = 20;
const PROJECT_ELAPSED_TIME_MS = 1240;

const createTemporaryDirectory = (): string => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-report-test-"));
  temporaryDirectories.push(temporaryDirectory);
  return temporaryDirectory;
};

const createDiagnostic = (overrides: Partial<Diagnostic> = {}): Diagnostic => ({
  filePath: "src/app.tsx",
  plugin: "react",
  rule: "no-danger",
  severity: "error",
  message: "Avoid dangerouslySetInnerHTML.",
  help: "Use safe rendering patterns.",
  line: DEFAULT_LINE_NUMBER,
  column: DEFAULT_COLUMN_NUMBER,
  category: "Security",
  ...overrides,
});

const createMarkdownReportData = (
  rootDirectory: string,
  diagnostics: Diagnostic[],
): MarkdownReportData => ({
  generatedAtIso: "2026-02-25T10:00:00.000Z",
  rootDirectory,
  isDiffMode: false,
  isOffline: false,
  isScoreOnly: false,
  isLintEnabled: true,
  isDeadCodeEnabled: true,
  isVerboseEnabled: true,
  diagnostics,
  projects: [
    {
      projectDirectory: rootDirectory,
      projectName: "web-app",
      framework: "nextjs",
      reactVersion: "^19.0.0",
      sourceFileCount: PROJECT_SOURCE_FILE_COUNT,
      diagnostics,
      scoreResult: { score: 82, label: "Great" },
      skippedChecks: [],
      elapsedMilliseconds: PROJECT_ELAPSED_TIME_MS,
    },
  ],
});

afterEach(() => {
  for (const temporaryDirectory of temporaryDirectories) {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
  temporaryDirectories.length = 0;
});

describe("writeMarkdownReport", () => {
  it("writes a markdown report to the requested relative path", () => {
    const temporaryDirectory = createTemporaryDirectory();
    const diagnostics = [createDiagnostic(), createDiagnostic({ line: SECOND_DIAGNOSTIC_LINE_NUMBER })];
    const markdownReportData = createMarkdownReportData(temporaryDirectory, diagnostics);

    const outputPath = writeMarkdownReport(markdownReportData, "reports/react-doctor-report.md");
    const reportContent = fs.readFileSync(outputPath, "utf-8");

    expect(outputPath).toBe(path.join(temporaryDirectory, "reports", "react-doctor-report.md"));
    expect(reportContent).toContain("# React Doctor Report");
    expect(reportContent).toContain("## Totals");
    expect(reportContent).toContain("- Diagnostics: 2");
    expect(reportContent).toContain("### web-app");
    expect(reportContent).toContain("##### react/no-danger");
    expect(reportContent).toContain("`src/app.tsx:12,18`");
  });

  it("writes an empty findings section when no diagnostics are present", () => {
    const temporaryDirectory = createTemporaryDirectory();
    const markdownReportData = createMarkdownReportData(temporaryDirectory, []);

    const outputPath = writeMarkdownReport(markdownReportData, "report.md");
    const reportContent = fs.readFileSync(outputPath, "utf-8");

    expect(reportContent).toContain("No diagnostics found.");
    expect(reportContent).toContain("- Diagnostics: 0");
    expect(reportContent).toContain("- Errors: 0");
    expect(reportContent).toContain("- Warnings: 0");
  });
});
