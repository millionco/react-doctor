import { render } from "ink-testing-library";
import { describe, expect, it } from "vite-plus/test";
import type { Diagnostic } from "@react-doctor/core";
import { ReportIssueStream } from "../../src/cli/ink/components/report-issue-stream.js";
import { buildDiagnosticRows } from "../../src/cli/ink/lib/diagnostic-rows.js";

const makeDiagnostic = (rule: string, title: string): Diagnostic => ({
  filePath: `src/${rule}.tsx`,
  plugin: "react-doctor",
  rule,
  title,
  severity: "warning",
  message: `${title} explanation`,
  help: "",
  line: 1,
  column: 1,
  category: "Performance",
});

describe("ReportIssueStream", () => {
  it("rolls a fixed window of findings toward the selected row", () => {
    const rows = buildDiagnosticRows(
      [
        makeDiagnostic("first", "First finding"),
        makeDiagnostic("second", "Second finding"),
        makeDiagnostic("third", "Third finding"),
      ],
      [null],
    );
    const { lastFrame, unmount } = render(
      <ReportIssueStream rows={rows} selectedIndex={1} width={80} />,
    );
    const frameLines = (lastFrame() ?? "").split("\n");

    expect(frameLines).toHaveLength(4);
    expect(frameLines[0]).toBe("Reviewing issues");
    expect(frameLines[1]).toContain("Third finding");
    expect(frameLines[2]).toContain("First finding");
    expect(frameLines[3]).toContain("› Performance: Second finding");
    unmount();
  });
});
