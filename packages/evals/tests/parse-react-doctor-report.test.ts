import { describe, expect, it } from "vite-plus/test";

import { parseReactDoctorReport } from "../src/utils/parse-react-doctor-report.js";

describe("parseReactDoctorReport", () => {
  it("returns successful reports", () => {
    const report = {
      schemaVersion: 3,
      version: "0.8.1",
      ok: true,
      directory: "/workspace/target",
      mode: "full",
      diff: null,
      projects: [],
      diagnostics: [],
      summary: {
        errorCount: 0,
        warningCount: 0,
        affectedFileCount: 0,
        totalDiagnosticCount: 0,
        score: null,
        scoreLabel: null,
      },
      elapsedMilliseconds: 1,
      error: null,
    };

    expect(parseReactDoctorReport(JSON.stringify(report))).toEqual(report);
  });

  it("throws the report error message for unsuccessful reports", () => {
    const report = { ok: false, error: { message: "No React project found" } };

    expect(() => parseReactDoctorReport(JSON.stringify(report))).toThrow("No React project found");
  });

  it("returns partial reports when React Doctor skips a slow check", () => {
    const report = {
      schemaVersion: 3,
      version: "0.8.1",
      ok: true,
      directory: "/workspace/target",
      mode: "full",
      diff: null,
      diagnostics: [],
      projects: [{ complete: false, diagnostics: [], skippedChecks: ["lint"] }],
      summary: {
        errorCount: 0,
        warningCount: 0,
        affectedFileCount: 0,
        totalDiagnosticCount: 0,
        score: null,
        scoreLabel: null,
      },
      elapsedMilliseconds: 1,
      error: null,
    };

    expect(parseReactDoctorReport(JSON.stringify(report), 1)).toEqual(report);
  });

  it("rejects reports without a success status", () => {
    expect(() => parseReactDoctorReport('{"diagnostics":[]}')).toThrow(
      "React Doctor returned an invalid JSON report",
    );
  });

  it("rejects structurally incomplete successful reports", () => {
    expect(() => parseReactDoctorReport('{"ok":true}')).toThrow(
      "React Doctor returned an invalid JSON report",
    );
  });

  it("preserves the exit code and output from crashed scans", () => {
    expect(() => parseReactDoctorReport("Killed", 137)).toThrow(
      /React Doctor exited with code 137:[\s\S]*Killed/,
    );
  });
});
