import {
  TUI_HORIZONTAL_PADDING_COLUMNS,
  TUI_REPORT_COLUMN_GUTTER_COLUMNS,
  TUI_REPORT_COMPACT_MAX_ROWS,
  TUI_REPORT_COMPACT_STATUS_ROWS,
  TUI_REPORT_DETAIL_ROWS,
  TUI_REPORT_DETAIL_WIDTH_FRACTION,
  TUI_REPORT_DIVIDER_ROWS,
  TUI_REPORT_LIST_MARGIN_ROWS,
  TUI_REPORT_MIN_COLUMN_WIDTH_CHARS,
  TUI_REPORT_MIN_LIST_ROWS,
  TUI_REPORT_MIN_WIDTH_CHARS,
  TUI_REPORT_STACKED_MAX_LIST_ROWS,
  TUI_REPORT_STATUS_ROWS,
  TUI_REPORT_VIEWER_SCORE_HEADER_ROWS,
  TUI_REPORT_VIEWPORT_MARGIN_ROWS,
  TUI_REPORT_WIDE_MIN_COLUMNS,
  TUI_REPORT_WIDE_MIN_ROWS,
} from "../../utils/constants.js";

export type DiagnosticListLayout = "compact" | "split" | "stacked";

export interface ReportLayoutInput {
  readonly columns: number;
  readonly diagnosticEntryCount: number;
  readonly terminalRows: number;
}

export interface ReportLayout {
  readonly detailColumnWidth: number;
  readonly detailHeight: number;
  readonly isStackedReportCapped: boolean;
  readonly layout: DiagnosticListLayout;
  readonly listColumnWidth: number;
  readonly listHeight: number;
  readonly showsViewerScoreHeader: boolean;
  readonly width: number;
}

const STACKED_FIXED_ROWS =
  TUI_REPORT_VIEWER_SCORE_HEADER_ROWS +
  TUI_REPORT_LIST_MARGIN_ROWS +
  TUI_REPORT_DIVIDER_ROWS +
  TUI_REPORT_STATUS_ROWS;

export const resolveReportLayout = ({
  columns,
  diagnosticEntryCount,
  terminalRows,
}: ReportLayoutInput): ReportLayout => {
  const width = Math.max(TUI_REPORT_MIN_WIDTH_CHARS, columns - TUI_HORIZONTAL_PADDING_COLUMNS);
  const reportRows = Math.max(0, terminalRows - TUI_REPORT_VIEWPORT_MARGIN_ROWS);
  const isWide = columns >= TUI_REPORT_WIDE_MIN_COLUMNS && terminalRows >= TUI_REPORT_WIDE_MIN_ROWS;
  const isCompact = !isWide && terminalRows <= TUI_REPORT_COMPACT_MAX_ROWS;
  const minimumRowsWithCompactViewerScoreHeader =
    TUI_REPORT_VIEWER_SCORE_HEADER_ROWS + TUI_REPORT_COMPACT_STATUS_ROWS + TUI_REPORT_MIN_LIST_ROWS;
  const showsViewerScoreHeader =
    !isCompact || reportRows >= minimumRowsWithCompactViewerScoreHeader;
  const detailHeight = Math.max(
    0,
    isWide
      ? reportRows - TUI_REPORT_STATUS_ROWS
      : Math.min(
          TUI_REPORT_DETAIL_ROWS,
          reportRows - STACKED_FIXED_ROWS - TUI_REPORT_MIN_LIST_ROWS,
        ),
  );

  const availableListHeight = isWide
    ? Math.max(
        TUI_REPORT_MIN_LIST_ROWS,
        detailHeight - TUI_REPORT_VIEWER_SCORE_HEADER_ROWS - TUI_REPORT_LIST_MARGIN_ROWS,
      )
    : Math.max(TUI_REPORT_MIN_LIST_ROWS, reportRows - STACKED_FIXED_ROWS - detailHeight);
  const isStackedReportCapped =
    !isCompact && !isWide && availableListHeight > TUI_REPORT_STACKED_MAX_LIST_ROWS;

  let listHeight = availableListHeight;
  if (isCompact) {
    const viewerScoreHeaderRows = showsViewerScoreHeader ? TUI_REPORT_VIEWER_SCORE_HEADER_ROWS : 0;
    listHeight = Math.min(
      diagnosticEntryCount,
      Math.max(
        TUI_REPORT_MIN_LIST_ROWS,
        reportRows - TUI_REPORT_COMPACT_STATUS_ROWS - viewerScoreHeaderRows,
      ),
    );
  } else if (!isWide) {
    listHeight = Math.min(
      diagnosticEntryCount,
      TUI_REPORT_STACKED_MAX_LIST_ROWS,
      availableListHeight,
    );
  }

  const detailColumnWidth = Math.max(
    TUI_REPORT_MIN_COLUMN_WIDTH_CHARS,
    Math.floor(width * TUI_REPORT_DETAIL_WIDTH_FRACTION),
  );
  const listColumnWidth = Math.max(
    TUI_REPORT_MIN_COLUMN_WIDTH_CHARS,
    width - detailColumnWidth - TUI_REPORT_COLUMN_GUTTER_COLUMNS,
  );

  let layout: DiagnosticListLayout = "stacked";
  if (isCompact) layout = "compact";
  else if (isWide) layout = "split";

  return {
    detailColumnWidth,
    detailHeight,
    isStackedReportCapped,
    layout,
    listColumnWidth,
    listHeight,
    showsViewerScoreHeader,
    width,
  };
};
