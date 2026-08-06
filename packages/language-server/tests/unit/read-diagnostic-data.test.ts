import { describe, expect, it } from "vite-plus/test";
import { DIAGNOSTIC_SOURCE } from "../../src/constants.js";
import { readDiagnosticData } from "../../src/utils/read-diagnostic-data.js";

const diagnosticData = {
  identity: "src/app.tsx:1:1:react-doctor/example",
  plugin: "react-doctor",
  rule: "example",
  ruleId: "react-doctor/example",
  category: "Maintainability",
  help: "Apply the recommendation.",
  url: null,
  suppressionHint: null,
  line: 1,
  column: 1,
  fsPath: "/workspace/src/app.tsx",
};

describe("readDiagnosticData", () => {
  it("returns a complete server-owned payload", () => {
    expect(readDiagnosticData({ source: DIAGNOSTIC_SOURCE, data: diagnosticData })).toEqual(
      diagnosticData,
    );
  });

  it("rejects incomplete round-tripped payloads", () => {
    expect(
      readDiagnosticData({
        source: DIAGNOSTIC_SOURCE,
        data: { ruleId: diagnosticData.ruleId },
      }),
    ).toBeNull();
  });

  it("rejects payloads from another diagnostic source", () => {
    expect(readDiagnosticData({ source: "typescript", data: diagnosticData })).toBeNull();
  });
});
