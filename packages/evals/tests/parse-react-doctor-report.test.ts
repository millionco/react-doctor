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

  it("rejects reports without a success status", () => {
    expect(() => parseReactDoctorReport('{"diagnostics":[]}')).toThrow(
      "React Doctor returned an invalid JSON report",
    );
  });
});
