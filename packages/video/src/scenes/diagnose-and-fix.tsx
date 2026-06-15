import { useMemo } from "react";
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
  FILE_SCAN_INITIAL_DELAY_FRAMES,
  FRAMES_PER_FILE,
  GREEN_COLOR,
  MUTED_COLOR,
  PERFECT_SCORE,
  RED_COLOR,
  SCENE_FILE_SCAN_DURATION_FRAMES,
  SCORE_ANIMATION_FRAMES,
  SCORE_BAR_WIDTH,
  SEVERITY_BADGE_RADIUS_PX,
  SEVERITY_BADGE_SIZE_PX,
  TARGET_SCORE,
  TEXT_COLOR,
  WARNING_BADGE_BACKGROUND_COLOR,
} from "../constants";
import type { VideoContent } from "../types";
import { DoctorFace } from "../components/doctor-face";
import { fontFamily } from "../utils/font";
import { getDoctorMood, getScoreColor, getScoreLabel } from "../utils/score-display";

const HERO_FACE_FONT_SIZE_PX = 80;
const HERO_NUMBER_FONT_SIZE_PX = 140;
const HERO_LABEL_FONT_SIZE_PX = 56;
const HERO_BAR_FONT_SIZE_PX = 48;
const HERO_GAP_PX = 48;
const HERO_TOP_PX = 348;
const HERO_LEFT_PX = 350;

const BADGE_FACE_FONT_SIZE_PX = 0;
const BADGE_NUMBER_FONT_SIZE_PX = 64;
const BADGE_LABEL_FONT_SIZE_PX = 40;
const BADGE_BAR_FONT_SIZE_PX = 32;
const BADGE_GAP_PX = 16;
const BADGE_TOP_PX = 840;
const BADGE_LEFT_PX = 80;

const SCORE_FADE_IN_FRAMES = 8;
const HERO_HOLD_END_FRAME = 40;
const TRANSITION_END_FRAME = 70;

const HEADER_FADE_START_FRAME = 55;
const HEADER_FADE_FRAMES = 12;
const HEADER_SLIDE_DOWN_PX = 30;

const PROMPT_FADE_START_FRAME = 55;
const PROMPT_FADE_FRAMES = 12;

const ITEMS_START_FRAME = 78;
const ITEM_STAGGER_FRAMES = 4;
const ITEM_FADE_FRAMES = 5;

const SPINNER_APPEAR_FRAME = 75;
const FIX_START_FRAME = 106;
const FIX_INTERVAL_FRAMES = 1;
const FIX_FADE_FRAMES = 3;
const ALL_FIXED_FADE_FRAMES = 8;
const SCORE_INTRO_OFFSET_FRAMES = 50;

const SCENE_HORIZONTAL_PADDING_PX = 80;
const SCENE_TOP_PADDING_PX = 60;
const PROMPT_TOP_PX = 280;
const STATUS_TOP_PX = 380;
const ITEMS_TOP_PX = 460;

const LOGO_FONT_SIZE_PX = 40;
const PROMPT_FONT_SIZE_PX = 44;
const DIAGNOSTIC_FONT_SIZE_PX = 32;
const DIAGNOSTIC_ROW_HEIGHT_PX = DIAGNOSTIC_FONT_SIZE_PX * 1.7;
const STATUS_FONT_SIZE_PX = 36;

const CLAUDE_LOGO_ART = ` ▐▛███▜▌`;
const CLAUDE_LOGO_ART_2 = `▝▜█████▛▘`;
const CLAUDE_LOGO_ART_3 = `  ▘▘ ▝▝`;
const CLAUDE_LOGO_COLOR = "#d77757";

const SPINNER_CHARS = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const SPINNER_SPEED = 3;
const SPINNER_COLOR = "#d77757";

const BACKGROUND_LINE_HEIGHT = 1.6;
const BACKGROUND_ROW_HEIGHT_PX =
  FILE_SCAN_FONT_SIZE_PX * BACKGROUND_LINE_HEIGHT + FILE_ROW_VERTICAL_PADDING_PX * 2;
const BACKGROUND_OPACITY = 0.07;

const VIEWPORT_HEIGHT_PX = 1080;
const CONTENT_PADDING_PX = 40;
const USABLE_HEIGHT_PX = VIEWPORT_HEIGHT_PX - CONTENT_PADDING_PX * 2;
const VISIBLE_ROW_COUNT = Math.floor(USABLE_HEIGHT_PX / BACKGROUND_ROW_HEIGHT_PX);
const FILE_SCAN_SCROLL_START = FILE_SCAN_INITIAL_DELAY_FRAMES + VISIBLE_ROW_COUNT * FRAMES_PER_FILE;

const lerpSize = (heroSize: number, smallSize: number, progress: number) =>
  heroSize + (smallSize - heroSize) * progress;

interface DiagnoseAndFixProps {
  content: VideoContent;
  showScore?: boolean;
}

export const DiagnoseAndFix = ({ content, showScore = true }: DiagnoseAndFixProps) => {
  const rawFrame = useCurrentFrame();
  const frame = rawFrame + (showScore ? 0 : SCORE_INTRO_OFFSET_FRAMES);

  const diagnostics = useMemo(
    () =>
      content.scannedIssues.filter(
        (issue) => issue.severity === "error" || issue.severity === "warning",
      ),
    [content.scannedIssues],
  );

  const backgroundTotalHeightPx = content.scannedIssues.length * BACKGROUND_ROW_HEIGHT_PX;
  const backgroundScrollPxPerFrame = (backgroundTotalHeightPx * 0.15) / 40;
  const fileScanMaxScrollPx = Math.max(0, backgroundTotalHeightPx - USABLE_HEIGHT_PX);
  const fileScanScrollEnd =
    FILE_SCAN_INITIAL_DELAY_FRAMES + content.scannedIssues.length * FRAMES_PER_FILE;
  const fileScanEndProgress = Math.min(
    1,
    (SCENE_FILE_SCAN_DURATION_FRAMES - FILE_SCAN_SCROLL_START) /
      (fileScanScrollEnd - FILE_SCAN_SCROLL_START),
  );
  const backgroundScrollOffsetPx =
    fileScanMaxScrollPx * Easing.inOut(Easing.quad)(Math.max(0, fileScanEndProgress));

  const scoreBlockOpacity = interpolate(frame, [0, SCORE_FADE_IN_FRAMES], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });

  const transitionProgress = interpolate(
    frame,
    [HERO_HOLD_END_FRAME, TRANSITION_END_FRAME],
    [0, 1],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.inOut(Easing.cubic),
    },
  );

  const scoreTopPx = lerpSize(HERO_TOP_PX, BADGE_TOP_PX, transitionProgress);
  const scoreLeftPx = lerpSize(HERO_LEFT_PX, BADGE_LEFT_PX, transitionProgress);
  const faceFontSize = lerpSize(
    HERO_FACE_FONT_SIZE_PX,
    BADGE_FACE_FONT_SIZE_PX,
    transitionProgress,
  );
  const numberFontSize = lerpSize(
    HERO_NUMBER_FONT_SIZE_PX,
    BADGE_NUMBER_FONT_SIZE_PX,
    transitionProgress,
  );
  const labelFontSize = lerpSize(
    HERO_LABEL_FONT_SIZE_PX,
    BADGE_LABEL_FONT_SIZE_PX,
    transitionProgress,
  );
  const barFontSize = lerpSize(HERO_BAR_FONT_SIZE_PX, BADGE_BAR_FONT_SIZE_PX, transitionProgress);
  const scoreGap = lerpSize(HERO_GAP_PX, BADGE_GAP_PX, transitionProgress);

  const headerOpacity = interpolate(
    frame,
    [HEADER_FADE_START_FRAME, HEADER_FADE_START_FRAME + HEADER_FADE_FRAMES],
    [0, 1],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.out(Easing.cubic),
    },
  );
  const headerTranslateY = interpolate(
    frame,
    [HEADER_FADE_START_FRAME, HEADER_FADE_START_FRAME + HEADER_FADE_FRAMES],
    [-HEADER_SLIDE_DOWN_PX, 0],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.out(Easing.cubic),
    },
  );

  const promptOpacity = interpolate(
    frame,
    [PROMPT_FADE_START_FRAME, PROMPT_FADE_START_FRAME + PROMPT_FADE_FRAMES],
    [0, 1],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.out(Easing.cubic),
    },
  );

  const spinnerCharIndex = Math.floor(frame / SPINNER_SPEED) % SPINNER_CHARS.length;
  const spinnerChar = SPINNER_CHARS[spinnerCharIndex];

  const fixedDiagnosticCount = Math.max(
    0,
    Math.min(diagnostics.length, Math.floor((frame - FIX_START_FRAME) / FIX_INTERVAL_FRAMES) + 1),
  );
  const isFixing = frame >= FIX_START_FRAME;
  const allFixed = fixedDiagnosticCount >= diagnostics.length;
  const allFixedFrame = FIX_START_FRAME + diagnostics.length * FIX_INTERVAL_FRAMES;
  const isSpinnerVisible = frame >= SPINNER_APPEAR_FRAME && !allFixed;

  const allFixedOpacity = interpolate(
    frame,
    [allFixedFrame, allFixedFrame + ALL_FIXED_FADE_FRAMES],
    [0, 1],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.out(Easing.cubic),
    },
  );

  let displayScore: number;
  if (frame < FIX_START_FRAME) {
    displayScore = Math.round(
      interpolate(frame, [0, SCORE_ANIMATION_FRAMES], [0, TARGET_SCORE], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
        easing: Easing.out(Easing.cubic),
      }),
    );
  } else {
    displayScore =
      TARGET_SCORE +
      Math.round((PERFECT_SCORE - TARGET_SCORE) * (fixedDiagnosticCount / diagnostics.length));
  }
  const scoreColor = getScoreColor(displayScore);
  const doctorMood = getDoctorMood(displayScore);
  const filledBarCount = Math.round((displayScore / PERFECT_SCORE) * SCORE_BAR_WIDTH);
  const emptyBarCount = SCORE_BAR_WIDTH - filledBarCount;

  return (
    <AbsoluteFill style={{ backgroundColor: BACKGROUND_COLOR }}>
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          overflow: "hidden",
          opacity: BACKGROUND_OPACITY * interpolate(frame, [HERO_HOLD_END_FRAME, TRANSITION_END_FRAME], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
          padding: "40px 60px",
        }}
      >
        <div
          style={{
            transform: `translateY(-${backgroundScrollOffsetPx + frame * backgroundScrollPxPerFrame}px)`,
          }}
        >
          {[...content.scannedIssues, ...content.scannedIssues, ...content.scannedIssues].map((issue, repeatIndex) => {
            const isError = issue.severity === "error";
            const isWarning = issue.severity === "warning";
            const isOk = issue.severity === "ok";
            return (
              <div
                key={`${issue.message}-${repeatIndex}`}
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

      <div
        style={{
          position: "absolute",
          top: SCENE_TOP_PADDING_PX,
          left: SCENE_HORIZONTAL_PADDING_PX,
          fontFamily,
          fontSize: LOGO_FONT_SIZE_PX,
          lineHeight: 1.4,
          opacity: headerOpacity * interpolate(frame, [ITEMS_START_FRAME - 10, ITEMS_START_FRAME], [1, 0.5], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
          whiteSpace: "pre",
        }}
      >
        <div>
          <span style={{ color: CLAUDE_LOGO_COLOR }}>{CLAUDE_LOGO_ART}</span>
          <span style={{ color: "white" }}> Claude Code</span>
        </div>
        <div>
          <span style={{ color: CLAUDE_LOGO_COLOR }}>{CLAUDE_LOGO_ART_2}</span>
          <span style={{ color: MUTED_COLOR }}> Opus 4.6 · Claude API</span>
        </div>
        <div>
          <span style={{ color: CLAUDE_LOGO_COLOR }}>{CLAUDE_LOGO_ART_3}</span>
          <span style={{ color: MUTED_COLOR }}> /Users/you/my-app</span>
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          top: PROMPT_TOP_PX,
          left: SCENE_HORIZONTAL_PADDING_PX,
          right: SCENE_HORIZONTAL_PADDING_PX,
          fontFamily,
          fontSize: PROMPT_FONT_SIZE_PX,
          color: TEXT_COLOR,
          opacity: promptOpacity,
          borderTop: "1px solid rgba(255,255,255,0.15)",
          borderBottom: "1px solid rgba(255,255,255,0.15)",
          padding: "8px 0",
        }}
      >
        <span style={{ color: MUTED_COLOR }}>❯ </span>
        <span style={{ color: "white" }}>{content.fixPrompt}</span>
      </div>

      <div
        style={{
          position: "absolute",
          top: STATUS_TOP_PX,
          left: SCENE_HORIZONTAL_PADDING_PX,
          fontFamily,
          fontSize: STATUS_FONT_SIZE_PX,
        }}
      >
        {isSpinnerVisible && (
          <>
            <span style={{ color: SPINNER_COLOR }}>{spinnerChar}</span>
            <span style={{ color: SPINNER_COLOR }}>{" Fixing issues..."}</span>
          </>
        )}
        {allFixed && (
          <span style={{ color: GREEN_COLOR, opacity: allFixedOpacity }}>✓ All issues fixed</span>
        )}
      </div>

      <div
        style={{
          position: "absolute",
          top: ITEMS_TOP_PX,
          left: SCENE_HORIZONTAL_PADDING_PX,
          right: SCENE_HORIZONTAL_PADDING_PX,
          height: 350,
          overflow: "hidden",
          zIndex: 10,
          opacity: interpolate(frame, [ITEMS_START_FRAME, ITEMS_START_FRAME + 10], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 60,
            background: `linear-gradient(to bottom, ${BACKGROUND_COLOR} 0%, transparent 100%)`,
            zIndex: 2,
            pointerEvents: "none",
          }}
        />
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            height: 60,
            background: `linear-gradient(to top, ${BACKGROUND_COLOR} 0%, transparent 100%)`,
            zIndex: 2,
            pointerEvents: "none",
          }}
        />
        <div
          style={{
            transform: `translateY(-${interpolate(frame, [ITEMS_START_FRAME, FIX_START_FRAME + diagnostics.length * FIX_INTERVAL_FRAMES], [0, Math.max(0, diagnostics.length * DIAGNOSTIC_ROW_HEIGHT_PX - 350)], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })}px)`,
            padding: "12px 0",
          }}
        >
          {diagnostics.map((diagnostic, diagnosticIndex) => {
            const itemFixFrame = FIX_START_FRAME + diagnosticIndex * FIX_INTERVAL_FRAMES;
            const itemFixProgress = interpolate(
              frame - itemFixFrame,
              [0, FIX_FADE_FRAMES],
              [0, 1],
              {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: Easing.out(Easing.cubic),
              },
            );
            const isItemFixed = isFixing && diagnosticIndex < fixedDiagnosticCount;
            const showAsFixed = isItemFixed && itemFixProgress > 0.3;

            const isError = diagnostic.severity === "error";
            const isWarning = diagnostic.severity === "warning";

            return (
              <div
                key={diagnostic.message}
                style={{
                  fontFamily,
                  fontSize: DIAGNOSTIC_FONT_SIZE_PX,
                  lineHeight: 1.7,
                  color: showAsFixed ? MUTED_COLOR : TEXT_COLOR,
                  textDecoration: showAsFixed ? "line-through" : "none",
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                }}
              >
                <span
                  style={{
                    width: 32,
                    height: 32,
                    flexShrink: 0,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: SEVERITY_BADGE_RADIUS_PX,
                    backgroundColor: showAsFixed
                      ? "transparent"
                      : isError
                        ? ERROR_BADGE_BACKGROUND_COLOR
                        : isWarning
                          ? WARNING_BADGE_BACKGROUND_COLOR
                          : "transparent",
                    color: showAsFixed ? GREEN_COLOR : ERROR_BADGE_TEXT_COLOR,
                    fontSize: DIAGNOSTIC_FONT_SIZE_PX * 0.7,
                    fontWeight: 700,
                    lineHeight: 1,
                  }}
                >
                  {showAsFixed ? "✓" : "!"}
                </span>
                <span style={{ flex: 1 }}>{diagnostic.message}</span>
                <span style={{ color: MUTED_COLOR, flexShrink: 0, fontSize: DIAGNOSTIC_FONT_SIZE_PX * 0.8 }}>
                  {diagnostic.file}
                </span>
              </div>
          );
        })}
        </div>
      </div>

      {showScore && (
      <div
        style={{
          position: "absolute",
          left: scoreLeftPx,
          top: scoreTopPx,
          display: "flex",
          gap: scoreGap,
          alignItems: "flex-start",
          opacity: scoreBlockOpacity,
          zIndex: 5,
        }}
      >
        <div
          style={{
            opacity: 1 - transitionProgress,
            overflow: "hidden",
            width: lerpSize(faceFontSize * 3.5, 0, transitionProgress),
          }}
        >
          <DoctorFace
            size={faceFontSize * 3.5}
            color={scoreColor}
            mood={doctorMood}
          />
        </div>
        <div>
          <div>
            <span
              style={{
                color: scoreColor,
                fontWeight: 500,
                fontSize: numberFontSize,
                fontFamily,
              }}
            >
              {displayScore}
            </span>
            <span
              style={{
                color: MUTED_COLOR,
                fontSize: labelFontSize,
                fontFamily,
              }}
            >
              {` / ${PERFECT_SCORE}  `}
            </span>
            <span
              style={{
                color: scoreColor,
                fontSize: labelFontSize,
                fontFamily,
              }}
            >
              {getScoreLabel(displayScore)}
            </span>
          </div>
          <div
            style={{
              marginTop: 8,
              letterSpacing: 2,
              fontSize: barFontSize,
              fontFamily,
            }}
          >
            <div
              style={{
                width: 900,
                height: barFontSize,
                backgroundColor: "#525252",
                display: "flex",
              }}
            >
              <div
                style={{
                  width: `${(filledBarCount / SCORE_BAR_WIDTH) * 100}%`,
                  height: "100%",
                  backgroundColor: scoreColor,
                }}
              />
            </div>
          </div>
        </div>
      </div>
      )}
    </AbsoluteFill>
  );
};
