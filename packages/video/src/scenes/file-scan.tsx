import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";
import {
  BACKGROUND_COLOR,
  ERROR_BADGE_BACKGROUND_COLOR,
  ERROR_BADGE_TEXT_COLOR,
  ERROR_ROW_BACKGROUND_COLOR,
  FILE_ROW_GAP_PX,
  FILE_ROW_HORIZONTAL_PADDING_PX,
  FILE_ROW_VERTICAL_PADDING_PX,
  FILE_SCAN_FONT_SIZE_PX,
  GREEN_COLOR,
  MUTED_COLOR,
  OVERLAY_GRADIENT_BOTTOM_PADDING_PX,
  OVERLAY_GRADIENT_HEIGHT_PX,
  OVERLAY_GRADIENT_HORIZONTAL_PADDING_PX,
  SEVERITY_BADGE_RADIUS_PX,
  SEVERITY_BADGE_SIZE_PX,
  TEXT_COLOR,
  WARNING_BADGE_BACKGROUND_COLOR,
} from "../constants";
import type { SceneProps } from "../types";
import { getBottomOverlayGradient } from "../utils/get-bottom-overlay-gradient";
import { fontFamily } from "../utils/font";

const LINE_HEIGHT_MULTIPLIER = 1.6;
const ROW_HEIGHT_PX =
  FILE_SCAN_FONT_SIZE_PX * LINE_HEIGHT_MULTIPLIER + FILE_ROW_VERTICAL_PADDING_PX * 2;
const CONTENT_PADDING_PX = 40;

const FRAMES_PER_ISSUE = 2;
const FADE_IN_FRAMES = 6;

const TITLE_FONT_SIZE_PX = 88;
const TITLE_FADE_IN_START_FRAME = 5;
const TITLE_FADE_IN_FRAMES = 12;

export const FileScan = ({ content }: SceneProps) => {
  const frame = useCurrentFrame();

  const totalListHeightPx = content.scannedIssues.length * ROW_HEIGHT_PX;
  const scrollPxPerFrame = (totalListHeightPx * 0.15) / 40;
  const scrollStartFrame = 20;
  const scrollY = frame > scrollStartFrame ? (frame - scrollStartFrame) * scrollPxPerFrame : 0;

  const titleOpacity = interpolate(
    frame,
    [TITLE_FADE_IN_START_FRAME, TITLE_FADE_IN_START_FRAME + TITLE_FADE_IN_FRAMES],
    [0, 1],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.out(Easing.cubic),
    },
  );

  return (
    <AbsoluteFill
      style={{
        backgroundColor: BACKGROUND_COLOR,
      }}
    >
      <div
        style={{
          width: "100%",
          height: "100%",
          overflow: "hidden",
          padding: `${CONTENT_PADDING_PX}px 60px`,
        }}
      >
        <div style={{ transform: `translateY(-${scrollY}px)` }}>
          {content.scannedIssues.map((issue, issueIndex) => {
            const issueOpacity = interpolate(
              frame,
              [issueIndex * FRAMES_PER_ISSUE, issueIndex * FRAMES_PER_ISSUE + FADE_IN_FRAMES],
              [0, 1],
              { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
            );
            const isError = issue.severity === "error";
            const isWarning = issue.severity === "warning";
            const isOk = issue.severity === "ok";
            return (
              <div
                key={issue.message}
                style={{
                  opacity: issueOpacity,
                  fontFamily,
                  fontSize: FILE_SCAN_FONT_SIZE_PX,
                  lineHeight: LINE_HEIGHT_MULTIPLIER,
                  color: isOk ? MUTED_COLOR : TEXT_COLOR,
                  whiteSpace: "nowrap",
                  display: "flex",
                  alignItems: "center",
                  gap: FILE_ROW_GAP_PX,
                  padding: `${FILE_ROW_VERTICAL_PADDING_PX}px ${FILE_ROW_HORIZONTAL_PADDING_PX}px`,
                  backgroundColor: isError ? ERROR_ROW_BACKGROUND_COLOR : "transparent",
                  borderRadius: 6,
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
                    backgroundColor: isError
                      ? ERROR_BADGE_BACKGROUND_COLOR
                      : isWarning
                        ? WARNING_BADGE_BACKGROUND_COLOR
                        : "transparent",
                    color: isOk ? GREEN_COLOR : ERROR_BADGE_TEXT_COLOR,
                    fontSize: FILE_SCAN_FONT_SIZE_PX * 0.7,
                    fontWeight: 700,
                    lineHeight: 1,
                  }}
                >
                  {isOk ? "✓" : "!"}
                </span>

                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>
                  {issue.message}
                </span>

                <span
                  style={{
                    color: MUTED_COLOR,
                    flexShrink: 0,
                    fontSize: FILE_SCAN_FONT_SIZE_PX * 0.75,
                  }}
                >
                  {issue.file}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <AbsoluteFill
        style={{
          justifyContent: "flex-start",
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            width: "100%",
            height: OVERLAY_GRADIENT_HEIGHT_PX,
            background: getBottomOverlayGradient(titleOpacity).replace("to top", "to bottom"),
            display: "flex",
            justifyContent: "center",
            alignItems: "flex-start",
            padding: `${OVERLAY_GRADIENT_BOTTOM_PADDING_PX}px ${OVERLAY_GRADIENT_HORIZONTAL_PADDING_PX}px 0`,
          }}
        >
          <div
            style={{
              fontFamily,
              fontSize: TITLE_FONT_SIZE_PX,
              fontWeight: 400,
              color: "white",
              opacity: titleOpacity,
              textAlign: "center",
              lineHeight: 1.4,
              textShadow: "0 0 40px rgba(10,10,10,0.95), 0 0 80px rgba(10,10,10,0.9), 0 0 120px rgba(10,10,10,0.8)",
            }}
          >
            {content.scanTitle}
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
