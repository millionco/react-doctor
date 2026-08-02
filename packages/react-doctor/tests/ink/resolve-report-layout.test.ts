import { describe, expect, it } from "vite-plus/test";
import {
  TUI_DEFAULT_TERMINAL_COLUMNS,
  TUI_REPORT_COMPACT_MAX_ROWS,
  TUI_REPORT_COMPACT_STATUS_ROWS,
  TUI_REPORT_DETAIL_ROWS,
  TUI_REPORT_DIVIDER_ROWS,
  TUI_REPORT_LIST_MARGIN_ROWS,
  TUI_REPORT_MIN_LIST_ROWS,
  TUI_REPORT_STATUS_ROWS,
  TUI_REPORT_VIEWER_SCORE_HEADER_ROWS,
  TUI_REPORT_VIEWPORT_MARGIN_ROWS,
} from "../../src/cli/utils/constants.js";
import { resolveReportLayout } from "../../src/cli/ink/lib/resolve-report-layout.js";

describe("resolveReportLayout", () => {
  it("fills the split viewport after reserving the header and footer", () => {
    const terminalRows = 40;
    const diagnosticEntryCount = 8;
    const layout = resolveReportLayout({ columns: 160, diagnosticEntryCount, terminalRows });

    expect(layout.layout).toBe("split");
    expect(layout.detailHeight).toBe(
      terminalRows - TUI_REPORT_VIEWPORT_MARGIN_ROWS - TUI_REPORT_STATUS_ROWS,
    );
    expect(layout.listHeight).toBe(
      terminalRows -
        TUI_REPORT_VIEWPORT_MARGIN_ROWS -
        TUI_REPORT_STATUS_ROWS -
        TUI_REPORT_VIEWER_SCORE_HEADER_ROWS -
        TUI_REPORT_LIST_MARGIN_ROWS,
    );
  });

  it("limits split findings to the live viewport after the header and footer", () => {
    const terminalRows = 24;
    const layout = resolveReportLayout({
      columns: 160,
      diagnosticEntryCount: 100,
      terminalRows,
    });

    expect(layout.listHeight).toBe(
      terminalRows -
        TUI_REPORT_VIEWPORT_MARGIN_ROWS -
        TUI_REPORT_STATUS_ROWS -
        TUI_REPORT_VIEWER_SCORE_HEADER_ROWS -
        TUI_REPORT_LIST_MARGIN_ROWS,
    );
  });

  it("keeps one issue visible in an extremely short compact viewport", () => {
    const layout = resolveReportLayout({
      columns: 40,
      diagnosticEntryCount: 3,
      terminalRows: TUI_REPORT_VIEWPORT_MARGIN_ROWS + TUI_REPORT_COMPACT_STATUS_ROWS,
    });

    expect(layout.layout).toBe("compact");
    expect(layout.listHeight).toBe(TUI_REPORT_MIN_LIST_ROWS);
    expect(layout.showsViewerScoreHeader).toBe(false);
  });

  it("reserves score header rows when they fit in a compact viewport", () => {
    const terminalRows = TUI_REPORT_COMPACT_MAX_ROWS;
    const layout = resolveReportLayout({
      columns: TUI_DEFAULT_TERMINAL_COLUMNS,
      diagnosticEntryCount: 100,
      terminalRows,
    });

    expect(layout.layout).toBe("compact");
    expect(layout.showsViewerScoreHeader).toBe(true);
    expect(layout.listHeight).toBe(
      terminalRows -
        TUI_REPORT_VIEWPORT_MARGIN_ROWS -
        TUI_REPORT_COMPACT_STATUS_ROWS -
        TUI_REPORT_VIEWER_SCORE_HEADER_ROWS,
    );
  });

  it("reserves score header rows in a stacked viewport", () => {
    const terminalRows = TUI_REPORT_COMPACT_MAX_ROWS + TUI_REPORT_DETAIL_ROWS;
    const layout = resolveReportLayout({
      columns: TUI_DEFAULT_TERMINAL_COLUMNS,
      diagnosticEntryCount: 100,
      terminalRows,
    });

    expect(layout.layout).toBe("stacked");
    expect(layout.listHeight).toBe(
      terminalRows -
        TUI_REPORT_VIEWPORT_MARGIN_ROWS -
        TUI_REPORT_STATUS_ROWS -
        TUI_REPORT_VIEWER_SCORE_HEADER_ROWS -
        TUI_REPORT_LIST_MARGIN_ROWS -
        TUI_REPORT_DIVIDER_ROWS -
        TUI_REPORT_DETAIL_ROWS,
    );
  });

  it("does not allocate an issue row when the report is clean", () => {
    const layout = resolveReportLayout({
      columns: 40,
      diagnosticEntryCount: 0,
      terminalRows: TUI_REPORT_VIEWPORT_MARGIN_ROWS + TUI_REPORT_COMPACT_STATUS_ROWS,
    });

    expect(layout.listHeight).toBe(0);
  });
});
