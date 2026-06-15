import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";
import {
  BACKGROUND_COLOR,
  CHAR_FRAMES,
  COMMAND,
  CURSOR_BLINK_FRAMES,
  ERROR_BADGE_BACKGROUND_COLOR,
  ERROR_BADGE_TEXT_COLOR,
  ERROR_ROW_BACKGROUND_COLOR,
  FILE_ROW_GAP_PX,
  FILE_ROW_HORIZONTAL_PADDING_PX,
  FILE_ROW_VERTICAL_PADDING_PX,
  FILE_SCAN_FONT_SIZE_PX,
  GREEN_COLOR,
  MUTED_COLOR,
  SEVERITY_BADGE_RADIUS_PX,
  SEVERITY_BADGE_SIZE_PX,
  TEXT_COLOR,
  TYPING_FONT_SIZE_PX,
  TYPING_INITIAL_DELAY_FRAMES,
  WARNING_BADGE_BACKGROUND_COLOR,
} from "../constants";
import type { SceneProps } from "../types";
import { fontFamily } from "../utils/font";

const BACKGROUND_LINE_HEIGHT = 1.6;
const BACKGROUND_ROW_HEIGHT_PX =
  FILE_SCAN_FONT_SIZE_PX * BACKGROUND_LINE_HEIGHT + FILE_ROW_VERTICAL_PADDING_PX * 2;
const BACKGROUND_FADE_IN_START_FRAME = 60;
const BACKGROUND_FADE_IN_FRAMES = 15;
const BACKGROUND_OPACITY = 0.07;

export const TerminalTyping = ({ content }: SceneProps) => {
  const frame = useCurrentFrame();
  const backgroundTotalHeightPx = content.scannedIssues.length * BACKGROUND_ROW_HEIGHT_PX;

  const typedCharCount = Math.min(
    COMMAND.length,
    Math.max(0, Math.floor((frame - TYPING_INITIAL_DELAY_FRAMES) / CHAR_FRAMES)),
  );
  const typedCommand = COMMAND.slice(0, typedCharCount);
  const isTypingDone = typedCharCount >= COMMAND.length;
  const isTypingActive = frame >= TYPING_INITIAL_DELAY_FRAMES && !isTypingDone;

  const cursorOpacity = isTypingActive
    ? 1
    : interpolate(
        frame % CURSOR_BLINK_FRAMES,
        [0, CURSOR_BLINK_FRAMES / 2, CURSOR_BLINK_FRAMES],
        [1, 0, 1],
        { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
      );

  const backgroundOpacity = interpolate(
    frame,
    [BACKGROUND_FADE_IN_START_FRAME, BACKGROUND_FADE_IN_START_FRAME + BACKGROUND_FADE_IN_FRAMES],
    [0, BACKGROUND_OPACITY],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) },
  );

  const scrollPxPerFrame = (backgroundTotalHeightPx * 0.15) / 20;
  const backgroundScrollY = Math.max(0, (frame - BACKGROUND_FADE_IN_START_FRAME) * scrollPxPerFrame);

  return (
    <AbsoluteFill
      style={{
        backgroundColor: BACKGROUND_COLOR,
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          overflow: "hidden",
          opacity: backgroundOpacity,
          padding: "40px 60px",
        }}
      >
        <div style={{ transform: `translateY(-${backgroundScrollY}px)` }}>
          {content.scannedIssues.map((issue) => {
            const isError = issue.severity === "error";
            const isWarning = issue.severity === "warning";
            const isOk = issue.severity === "ok";
            return (
              <div
                key={issue.message}
                style={{
                  fontFamily,
                  fontSize: FILE_SCAN_FONT_SIZE_PX,
                  lineHeight: BACKGROUND_LINE_HEIGHT,
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
          justifyContent: "center",
          padding: "0 80px 0 160px",
        }}
      >
        <div
          style={{
            fontFamily,
            fontSize: TYPING_FONT_SIZE_PX,
            lineHeight: 1.7,
            color: TEXT_COLOR,
            whiteSpace: "nowrap",
          }}
        >
          <span style={{ color: MUTED_COLOR }}>$ </span>
          <span style={{ color: "white" }}>{typedCommand}</span>
          <span style={{ opacity: cursorOpacity }}>▋</span>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
