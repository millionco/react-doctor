import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";
import {
  BACKGROUND_COLOR,
  ERROR_BADGE_BACKGROUND_COLOR,
  ERROR_BADGE_TEXT_COLOR,
  ERROR_ROW_BACKGROUND_COLOR,
  MUTED_COLOR,
  TEXT_COLOR,
  WARNING_BADGE_BACKGROUND_COLOR,
} from "../constants";
import type { SceneProps } from "../types";
import { fontFamily } from "../utils/font";

const SCENE_PADDING_LEFT_PX = 150;
const SCENE_PADDING_TOP_PX = 110;
const HEADER_FONT_SIZE_PX = 84;
const SCAN_LINE_FONT_SIZE_PX = 46;
const ROW_FONT_SIZE_PX = 40;
const ROW_GAP_PX = 12;
const ROW_HORIZONTAL_PADDING_PX = 16;
const ROW_VERTICAL_PADDING_PX = 6;
const BADGE_SIZE_PX = 38;
const BADGE_RADIUS_PX = 6;
const BRIGHT_TEXT_COLOR = "#fafafa";

const SCAN_FILES = [
  "app/layout.tsx",
  "app/api/users/route.ts",
  "lib/db.ts",
  "lib/auth.ts",
  "middleware.ts",
];
const SCANNED_FILE_COUNT = 173;
const VISIBLE_ISSUE_COUNT = 8;

const HEADER_IN_FRAME = 2;
const SCAN_IN_FRAME = 8;
const SCAN_CYCLE_FRAMES = 4;
const ISSUES_START_FRAME = 22;
const ISSUE_STAGGER_FRAMES = 5;
const REVEAL_FADE_FRAMES = 5;
const REVEAL_RISE_PX = 10;

export const SecurityScan = ({ content }: SceneProps) => {
  const frame = useCurrentFrame();

  const scanIndex = Math.min(
    SCAN_FILES.length - 1,
    Math.max(0, Math.floor((frame - SCAN_IN_FRAME) / SCAN_CYCLE_FRAMES)),
  );
  const currentScanFile = SCAN_FILES[scanIndex];
  const scannedFileCount = Math.round(
    interpolate(frame, [SCAN_IN_FRAME, ISSUES_START_FRAME], [0, SCANNED_FILE_COUNT], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }),
  );

  const issues = content.scannedIssues.slice(0, VISIBLE_ISSUE_COUNT);

  const reveal = (startFrame: number) => ({
    opacity: interpolate(frame, [startFrame, startFrame + REVEAL_FADE_FRAMES], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }),
    transform: `translateY(${interpolate(
      frame,
      [startFrame, startFrame + REVEAL_FADE_FRAMES],
      [REVEAL_RISE_PX, 0],
      { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) },
    )}px)`,
  });

  return (
    <AbsoluteFill style={{ backgroundColor: BACKGROUND_COLOR }}>
      <div
        style={{
          position: "absolute",
          top: SCENE_PADDING_TOP_PX,
          left: SCENE_PADDING_LEFT_PX,
          right: SCENE_PADDING_LEFT_PX,
          fontFamily,
        }}
      >
        <div
          style={{
            fontSize: HEADER_FONT_SIZE_PX,
            lineHeight: 1.5,
            color: BRIGHT_TEXT_COLOR,
            ...reveal(HEADER_IN_FRAME),
          }}
        >
          Scan for vulnerabilities
        </div>
        <div
          style={{
            fontSize: SCAN_LINE_FONT_SIZE_PX,
            lineHeight: 1.5,
            color: MUTED_COLOR,
            marginTop: 8,
            ...reveal(SCAN_IN_FRAME),
          }}
        >
          ↳ scanning {currentScanFile} · {scannedFileCount} files
        </div>

        <div style={{ marginTop: 44 }}>
          {issues.map((issue, issueIndex) => {
            const isError = issue.severity === "error";
            return (
              <div
                key={issue.message}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 20,
                  fontSize: ROW_FONT_SIZE_PX,
                  lineHeight: 1.4,
                  marginTop: issueIndex === 0 ? 0 : ROW_GAP_PX,
                  padding: `${ROW_VERTICAL_PADDING_PX}px ${ROW_HORIZONTAL_PADDING_PX}px`,
                  borderRadius: 8,
                  backgroundColor: isError ? ERROR_ROW_BACKGROUND_COLOR : "transparent",
                  ...reveal(ISSUES_START_FRAME + issueIndex * ISSUE_STAGGER_FRAMES),
                }}
              >
                <span
                  style={{
                    width: BADGE_SIZE_PX,
                    height: BADGE_SIZE_PX,
                    flexShrink: 0,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: BADGE_RADIUS_PX,
                    backgroundColor: isError
                      ? ERROR_BADGE_BACKGROUND_COLOR
                      : WARNING_BADGE_BACKGROUND_COLOR,
                    color: ERROR_BADGE_TEXT_COLOR,
                    fontSize: ROW_FONT_SIZE_PX * 0.7,
                    fontWeight: 700,
                    lineHeight: 1,
                  }}
                >
                  !
                </span>
                <span
                  style={{
                    flex: 1,
                    color: TEXT_COLOR,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {issue.message}
                </span>
                <span
                  style={{ flexShrink: 0, color: MUTED_COLOR, fontSize: ROW_FONT_SIZE_PX * 0.85 }}
                >
                  {issue.file}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};
