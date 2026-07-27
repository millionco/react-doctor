import {
  ERROR_BADGE_BACKGROUND_COLOR,
  ERROR_BADGE_TEXT_COLOR,
  ERROR_ROW_BACKGROUND_COLOR,
  FILE_ROW_GAP_PX,
  FILE_ROW_HORIZONTAL_PADDING_PX,
  FILE_ROW_VERTICAL_PADDING_PX,
  FONT_FAMILY,
  GREEN_COLOR,
  MUTED_COLOR,
  SEVERITY_BADGE_RADIUS_PX,
  SEVERITY_BADGE_SIZE_PX,
  TEXT_COLOR,
  WARNING_BADGE_BACKGROUND_COLOR,
  type ScannedIssue,
} from "../constants";

export interface IssueRowProps {
  fontSize: number;
  isFixed?: boolean;
  issue: ScannedIssue;
  opacity?: number;
}

export const IssueRow = ({ fontSize, isFixed = false, issue, opacity = 1 }: IssueRowProps) => {
  const isError = issue.severity === "error";
  let badgeBackgroundColor = WARNING_BADGE_BACKGROUND_COLOR;
  if (isError) badgeBackgroundColor = ERROR_BADGE_BACKGROUND_COLOR;
  if (isFixed) badgeBackgroundColor = "transparent";

  return (
    <div
      style={{
        opacity,
        fontFamily: FONT_FAMILY,
        fontSize,
        lineHeight: 1.6,
        color: isFixed ? MUTED_COLOR : TEXT_COLOR,
        textDecoration: isFixed ? "line-through" : "none",
        whiteSpace: "nowrap",
        display: "flex",
        alignItems: "center",
        gap: FILE_ROW_GAP_PX,
        padding: `${FILE_ROW_VERTICAL_PADDING_PX}px ${FILE_ROW_HORIZONTAL_PADDING_PX}px`,
        backgroundColor: !isFixed && isError ? ERROR_ROW_BACKGROUND_COLOR : "transparent",
        borderRadius: SEVERITY_BADGE_RADIUS_PX,
      }}
    >
      <span
        style={{
          width: SEVERITY_BADGE_SIZE_PX,
          height: SEVERITY_BADGE_SIZE_PX,
          flexShrink: 0,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: SEVERITY_BADGE_RADIUS_PX,
          backgroundColor: badgeBackgroundColor,
          color: isFixed ? GREEN_COLOR : ERROR_BADGE_TEXT_COLOR,
          fontSize: fontSize * 0.7,
          fontWeight: 700,
          lineHeight: 1,
        }}
      >
        {isFixed ? "✓" : "!"}
      </span>
      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>{issue.message}</span>
      <span style={{ color: MUTED_COLOR, flexShrink: 0, fontSize: fontSize * 0.75 }}>
        {issue.file}
      </span>
    </div>
  );
};
