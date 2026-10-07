import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vite-plus/test";

const repositoryRoot = path.resolve(import.meta.dirname, "../../..");
const scriptPath = path.join(repositoryRoot, "scripts", "ensure-json-report.mjs");
const temporaryDirectories: string[] = [];

const runEnsureJsonReport = (reportPath: string, scanStatus: number) =>
  spawnSync(process.execPath, [scriptPath, reportPath, String(scanStatus)], {
    encoding: "utf8",
  });

const createReportPath = (): string => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-report-"));
  temporaryDirectories.push(temporaryDirectory);
  return path.join(temporaryDirectory, "report.json");
};

afterEach(() => {
  for (const temporaryDirectory of temporaryDirectories.splice(0)) {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

describe("ensure-json-report", () => {
  it("removes leading npm output from a valid report", () => {
    const reportPath = createReportPath();
    const report = { schemaVersion: 3, ok: true, diagnostics: [] };
    fs.writeFileSync(
      reportPath,
      `npm warn exec {cache miss}\nnpm warn exec Installing react-doctor\n${JSON.stringify(report)}\n`,
    );

    const result = runEnsureJsonReport(reportPath, 0);

    expect(result.status).toBe(0);
    expect(JSON.parse(fs.readFileSync(reportPath, "utf8"))).toEqual(report);
  });

  it("keeps a clean valid report", () => {
    const reportPath = createReportPath();
    const report = { schemaVersion: 3, ok: false, diagnostics: [] };
    fs.writeFileSync(reportPath, `${JSON.stringify(report)}\n`);

    const result = runEnsureJsonReport(reportPath, 1);

    expect(result.status).toBe(0);
    expect(JSON.parse(fs.readFileSync(reportPath, "utf8"))).toEqual(report);
  });

  it("replaces invalid output with a fallback report", () => {
    const reportPath = createReportPath();
    fs.writeFileSync(reportPath, "npm output without a report\n");

    const result = runEnsureJsonReport(reportPath, 42);
    const fallbackReport = JSON.parse(fs.readFileSync(reportPath, "utf8"));

    expect(result.status).toBe(1);
    expect(fallbackReport).toMatchObject({
      schemaVersion: 3,
      ok: false,
      error: {
        message: "react-doctor exited with status 42 before producing a JSON report.",
      },
    });
  });
});
