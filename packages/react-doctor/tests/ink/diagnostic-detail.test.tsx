import { render } from "ink-testing-library";
import { describe, expect, it } from "vite-plus/test";
import type { DiagnosticRow } from "../../src/cli/ink/lib/diagnostic-rows.js";
import { DiagnosticDetail } from "../../src/cli/ink/components/diagnostic-detail.js";

const ROW: DiagnosticRow = {
  ruleKey: "react-doctor/example-rule",
  diagnostics: [],
  severity: "warning",
  category: "Bugs",
  title: "Example issue",
  location: "src/App.tsx:1",
  siteCount: 1,
  representative: {
    filePath: "src/App.tsx",
    plugin: "react-doctor",
    rule: "example-rule",
    severity: "warning",
    message: "This explains the issue.",
    help: "Apply the focused fix.",
    line: 1,
    column: 1,
    category: "Bugs",
  },
  ruleGuideUrl: null,
};

describe("DiagnosticDetail", () => {
  it("separates each evidence section with a blank row", () => {
    const { lastFrame, unmount } = render(<DiagnosticDetail row={ROW} rootDirectory="/missing" />);
    const lines = (lastFrame() ?? "").split("\n");
    const impactIndex = lines.findIndex((line) => line.includes("Impact"));
    const whyIndex = lines.findIndex((line) => line.includes("Why"));
    const fixIndex = lines.findIndex((line) => line.includes("Fix"));

    expect(lines[impactIndex - 1]).toBe("");
    expect(lines[whyIndex - 1]).toBe("");
    expect(lines[fixIndex - 1]).toBe("");
    unmount();
  });
});
