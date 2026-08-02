import { describe, expect, it } from "vite-plus/test";
import { buildEmptyReportMessage } from "../src/cli/utils/build-empty-report-message.js";

describe("buildEmptyReportMessage", () => {
  it("names an active category filter", () => {
    expect(
      buildEmptyReportMessage({
        categoryFilters: ["Security"],
        demotedDiagnosticCount: 0,
        outputSurface: "cli",
      }),
    ).toBe("No issues found in category Security!");
  });

  it("explains when surface settings hide every issue", () => {
    expect(
      buildEmptyReportMessage({
        categoryFilters: [],
        demotedDiagnosticCount: 3,
        outputSurface: "cli",
      }),
    ).toBe("No issues found! (3 demoted from the cli surface — see config.surfaces.)");
  });

  it("keeps the clean result concise", () => {
    expect(
      buildEmptyReportMessage({
        categoryFilters: [],
        demotedDiagnosticCount: 0,
        outputSurface: "cli",
      }),
    ).toBe("No issues found!");
  });
});
