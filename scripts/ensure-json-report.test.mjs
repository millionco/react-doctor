import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.join(__dirname, "ensure-json-report.mjs");

const validReport = {
  schemaVersion: 3,
  version: "0.9.12",
  ok: true,
  directory: "/test",
  mode: "full",
  diff: null,
  projects: [],
  diagnostics: [],
  summary: {
    errorCount: 0,
    warningCount: 0,
    affectedFileCount: 0,
    totalDiagnosticCount: 0,
    score: 100,
    scoreLabel: "excellent",
  },
  elapsedMilliseconds: 1234,
};

const runScript = (reportPath, exitCode) => {
  return new Promise((resolve) => {
    const proc = spawn(process.execPath, [scriptPath, reportPath, String(exitCode)], {
      stdio: "pipe",
    });
    proc.on("close", (code) => {
      resolve(code);
    });
  });
};

describe("ensure-json-report.mjs", () => {
  let tempDir;
  let reportPath;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ensure-json-report-test-"));
    reportPath = path.join(tempDir, "report.json");
  });

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("accepts valid JSON report and exits 0", async () => {
    fs.writeFileSync(reportPath, JSON.stringify(validReport));
    const exitCode = await runScript(reportPath, 0);
    expect(exitCode).toBe(0);
    const content = JSON.parse(fs.readFileSync(reportPath, "utf8"));
    expect(content.ok).toBe(true);
  });

  it("strips leading npm warning and accepts report", async () => {
    const corruptedContent = `npm warn exec The following package was not found and will be installed: react-doctor@0.9.12
${JSON.stringify(validReport)}`;
    fs.writeFileSync(reportPath, corruptedContent);
    const exitCode = await runScript(reportPath, 0);
    expect(exitCode).toBe(0);
  });

  it("strips multiple leading lines before JSON", async () => {
    const corruptedContent = `npm warn exec The following package was not found and will be installed: react-doctor@0.9.12
npm warn exec Some other warning
${JSON.stringify(validReport)}`;
    fs.writeFileSync(reportPath, corruptedContent);
    const exitCode = await runScript(reportPath, 0);
    expect(exitCode).toBe(0);
  });

  it("writes fallback report for completely invalid content", async () => {
    fs.writeFileSync(reportPath, "completely invalid content with no JSON");
    const exitCode = await runScript(reportPath, 1);
    expect(exitCode).toBe(1);
    const content = JSON.parse(fs.readFileSync(reportPath, "utf8"));
    expect(content.ok).toBe(false);
    expect(content.schemaVersion).toBe(3);
    expect(content.error).toBeDefined();
  });

  it("writes fallback report when report has invalid schema version", async () => {
    const invalidReport = { ...validReport, schemaVersion: 999 };
    fs.writeFileSync(reportPath, JSON.stringify(invalidReport));
    const exitCode = await runScript(reportPath, 1);
    expect(exitCode).toBe(1);
    const content = JSON.parse(fs.readFileSync(reportPath, "utf8"));
    expect(content.ok).toBe(false);
  });

  it("writes fallback report when report is missing ok field", async () => {
    const invalidReport = { ...validReport };
    delete invalidReport.ok;
    fs.writeFileSync(reportPath, JSON.stringify(invalidReport));
    const exitCode = await runScript(reportPath, 1);
    expect(exitCode).toBe(1);
    const content = JSON.parse(fs.readFileSync(reportPath, "utf8"));
    expect(content.ok).toBe(false);
  });

  it("preserves scan failure exit code in fallback message", async () => {
    fs.writeFileSync(reportPath, "invalid");
    const exitCode = await runScript(reportPath, 42);
    expect(exitCode).toBe(1);
    const content = JSON.parse(fs.readFileSync(reportPath, "utf8"));
    expect(content.error.message).toContain("status 42");
  });

  it("accepts report with schemaVersion 1", async () => {
    const v1Report = { ...validReport, schemaVersion: 1 };
    fs.writeFileSync(reportPath, JSON.stringify(v1Report));
    const exitCode = await runScript(reportPath, 0);
    expect(exitCode).toBe(0);
  });

  it("accepts report with schemaVersion 2", async () => {
    const v2Report = { ...validReport, schemaVersion: 2 };
    fs.writeFileSync(reportPath, JSON.stringify(v2Report));
    const exitCode = await runScript(reportPath, 0);
    expect(exitCode).toBe(0);
  });
});
