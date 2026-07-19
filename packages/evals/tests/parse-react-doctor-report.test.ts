import { describe, expect, it } from "vite-plus/test";

import { parseReactDoctorReport } from "../src/utils/parse-react-doctor-report.js";

describe("parseReactDoctorReport", () => {
  it("returns successful reports", () => {
    const report = { ok: true, diagnostics: [] };

    expect(parseReactDoctorReport(JSON.stringify(report))).toEqual(report);
  });

  it("throws the report error message for unsuccessful reports", () => {
    const report = { ok: false, error: { message: "No React project found" } };

    expect(() => parseReactDoctorReport(JSON.stringify(report))).toThrow("No React project found");
  });

  it("returns partial reports when React Doctor skips a slow check", () => {
    const report = {
      ok: true,
      diagnostics: [],
      projects: [{ complete: false, diagnostics: [], skippedChecks: ["lint"] }],
    };

    expect(parseReactDoctorReport(JSON.stringify(report), 1)).toEqual(report);
  });

  it("rejects reports without a success status", () => {
    expect(() => parseReactDoctorReport('{"diagnostics":[]}')).toThrow(
      "React Doctor returned an invalid JSON report",
    );
  });

  it("preserves the exit code and output from crashed scans", () => {
    expect(() => parseReactDoctorReport("Killed", 137)).toThrow(
      /React Doctor exited with code 137:[\s\S]*Killed/,
    );
  });
});
