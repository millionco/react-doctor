import {
  ERROR_BADGE_BACKGROUND_COLOR,
  ERROR_BADGE_TEXT_COLOR,
  ERROR_ROW_BACKGROUND_COLOR,
  FONT_FAMILY,
  GREEN_COLOR,
  MUTED_COLOR,
  TEXT_COLOR,
  WARNING_BADGE_BACKGROUND_COLOR,
} from "../constants";
import {
  V2_SCAN_BADGE_RADIUS_PX,
  V2_SCAN_BADGE_SIZE_PX,
  V2_SCAN_FONT_SIZE_PX,
  V2_SCAN_LINE_HEIGHT,
  V2_SCAN_ROW_GAP_PX,
  V2_SCAN_ROW_HORIZONTAL_PADDING_PX,
  V2_SCAN_ROW_VERTICAL_PADDING_PX,
  type V2ScannedIssue,
} from "../v2-constants";

export interface V2ScanRowProps {
  issue: V2ScannedIssue;
  opacity?: number;
}

export const V2ScanRow = ({ issue, opacity = 1 }: V2ScanRowProps) => {
  const isError = issue.severity === "error";
  const isWarning = issue.severity === "warning";
  const isOk = issue.severity === "ok";

  return (
    <div
      style={{
        opacity,
        fontFamily: FONT_FAMILY,
        fontSize: V2_SCAN_FONT_SIZE_PX,
        lineHeight: V2_SCAN_LINE_HEIGHT,
        color: isOk ? MUTED_COLOR : TEXT_COLOR,
        whiteSpace: "nowrap",
        display: "flex",
        alignItems: "center",
        gap: V2_SCAN_ROW_GAP_PX,
        padding: `${V2_SCAN_ROW_VERTICAL_PADDING_PX}px ${V2_SCAN_ROW_HORIZONTAL_PADDING_PX}px`,
        backgroundColor: isError ? ERROR_ROW_BACKGROUND_COLOR : "transparent",
        borderRadius: V2_SCAN_BADGE_RADIUS_PX,
      }}
    >
      <span
        style={{
          width: V2_SCAN_BADGE_SIZE_PX,
          height: V2_SCAN_BADGE_SIZE_PX,
          flexShrink: 0,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: V2_SCAN_BADGE_RADIUS_PX,
          backgroundColor: isError
            ? ERROR_BADGE_BACKGROUND_COLOR
            : isWarning
              ? WARNING_BADGE_BACKGROUND_COLOR
              : "transparent",
          color: isOk ? GREEN_COLOR : ERROR_BADGE_TEXT_COLOR,
          fontSize: V2_SCAN_FONT_SIZE_PX * 0.7,
          fontWeight: 700,
          lineHeight: 1,
        }}
      >
        {isOk ? "✓" : "!"}
      </span>
      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>{issue.message}</span>
      <span
        style={{
          color: MUTED_COLOR,
          flexShrink: 0,
          fontSize: V2_SCAN_FONT_SIZE_PX * 0.75,
        }}
      >
        {issue.file}
      </span>
    </div>
  );
};
