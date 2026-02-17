import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";
import {
  AFFECTED_FILE_COUNT,
  BACKGROUND_COLOR,
  BOX_BOTTOM,
  BOX_TOP,
  DIAGNOSTICS,
  ELAPSED_TIME,
  FRAMES_PER_DIAGNOSTIC,
  GREEN_COLOR,
  MUTED_COLOR,
  OVERLAY_GRADIENT_BOTTOM_PADDING_PX,
  OVERLAY_GRADIENT_HEIGHT_PX,
  OVERLAY_GRADIENT_HORIZONTAL_PADDING_PX,
  PERFECT_SCORE,
  RED_COLOR,
  SCORE_ANIMATION_FRAMES,
  SCORE_BAR_WIDTH,
  SCENE_DIAGNOSTICS_DURATION_FRAMES,
  TARGET_SCORE,
  TEXT_COLOR,
  TOTAL_ERROR_COUNT,
} from "../constants";
import { getBottomOverlayGradient } from "../utils/get-bottom-overlay-gradient";
import { fontFamily } from "../utils/font";

const HERO_FACE_FONT_SIZE_PX = 80;
const HERO_NUMBER_FONT_SIZE_PX = 96;
const HERO_LABEL_FONT_SIZE_PX = 56;
const HERO_BAR_FONT_SIZE_PX = 48;

const SMALL_FACE_FONT_SIZE_PX = 40;
const SMALL_NUMBER_FONT_SIZE_PX = 44;
const SMALL_LABEL_FONT_SIZE_PX = 32;
const SMALL_BAR_FONT_SIZE_PX = 28;

const SUMMARY_FONT_SIZE_PX = 34;
const DIAGNOSTIC_FONT_SIZE_PX = 34;

const SCORE_FADE_IN_FRAMES = 10;
const SHRINK_START_FRAME = 30;
const SHRINK_DURATION_FRAMES = 20;
const SHRINK_END_FRAME = SHRINK_START_FRAME + SHRINK_DURATION_FRAMES;
const DIAGNOSTIC_FADE_IN_FRAMES = 6;
const ERRORS_START_DELAY_FRAMES = 58;

const OVERLAY_START_RATIO = 0.28;
const OVERLAY_START_FRAME = Math.floor(SCENE_DIAGNOSTICS_DURATION_FRAMES * OVERLAY_START_RATIO);
const OVERLAY_FADE_IN_FRAMES = 15;
const OVERLAY_HOLD_FRAMES = 35;
const OVERLAY_FADE_OUT_FRAMES = 15;
const OVERLAY_END_FRAME =
  OVERLAY_START_FRAME + OVERLAY_FADE_IN_FRAMES + OVERLAY_HOLD_FRAMES + OVERLAY_FADE_OUT_FRAMES;
const OVERLAY_TITLE_FONT_SIZE_PX = 88;
const FIX_START_DELAY_FRAMES = 12;
const FIX_INTERVAL_FRAMES = 12;
const FIX_TRANSITION_FRAMES = 8;
const FINAL_SCORE_DELAY_FRAMES = 8;
const FINAL_SCORE_ANIMATION_FRAMES = 30;
const STATUS_FADE_IN_FRAMES = 8;
const STATUS_FONT_SIZE_PX = 34;
const FIXED_ERROR_COUNT = 0;
const FIXED_FILE_COUNT = 0;
const FIXED_ELAPSED_TIME = "3.6s";

const getScoreColor = (score: number) => {
  if (score >= 75) return "#4ade80";
  if (score >= 50) return "#eab308";
  return RED_COLOR;
};

const getScoreLabel = (score: number) => {
  if (score >= 75) return "Great";
  if (score >= 50) return "Needs work";
  return "Critical";
};

const getDoctorFace = (score: number): [string, string] => {
  if (score >= 75) return ["◠ ◠", " ▽ "];
  if (score >= 50) return ["• •", " ─ "];
  return ["x x", " ▽ "];
};

const lerpSize = (heroSize: number, smallSize: number, progress: number) =>
  heroSize + (smallSize - heroSize) * progress;

export const Diagnostics = () => {
  const frame = useCurrentFrame();
  const fixStartFrame = OVERLAY_END_FRAME + FIX_START_DELAY_FRAMES;
  const allFixedFrame = fixStartFrame + DIAGNOSTICS.length * FIX_INTERVAL_FRAMES;
  const finalScoreStartFrame = allFixedFrame + FINAL_SCORE_DELAY_FRAMES;
  const finalScoreEndFrame = finalScoreStartFrame + FINAL_SCORE_ANIMATION_FRAMES;
  const isFixing = frame >= fixStartFrame && frame < allFixedFrame;
  const isAllFixed = frame >= allFixedFrame;

  const scoreBlockOpacity = interpolate(frame, [0, SCORE_FADE_IN_FRAMES], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });

  const initialScore = interpolate(frame, [0, SCORE_ANIMATION_FRAMES], [0, TARGET_SCORE], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  const finalScore = interpolate(
    frame,
    [finalScoreStartFrame, finalScoreEndFrame],
    [TARGET_SCORE, PERFECT_SCORE],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.out(Easing.cubic),
    },
  );
  const currentScore = Math.round(frame < finalScoreStartFrame ? initialScore : finalScore);
  const scoreColor = getScoreColor(currentScore);
  const [eyes, mouth] = getDoctorFace(currentScore);
  const filledBarCount = Math.round((currentScore / PERFECT_SCORE) * SCORE_BAR_WIDTH);
  const emptyBarCount = SCORE_BAR_WIDTH - filledBarCount;

  const shrinkProgress = interpolate(frame, [SHRINK_START_FRAME, SHRINK_END_FRAME], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.quad),
  });

  const faceFontSize = lerpSize(HERO_FACE_FONT_SIZE_PX, SMALL_FACE_FONT_SIZE_PX, shrinkProgress);
  const numberFontSize = lerpSize(
    HERO_NUMBER_FONT_SIZE_PX,
    SMALL_NUMBER_FONT_SIZE_PX,
    shrinkProgress,
  );
  const labelFontSize = lerpSize(HERO_LABEL_FONT_SIZE_PX, SMALL_LABEL_FONT_SIZE_PX, shrinkProgress);
  const barFontSize = lerpSize(HERO_BAR_FONT_SIZE_PX, SMALL_BAR_FONT_SIZE_PX, shrinkProgress);

  const summaryOpacity = interpolate(frame, [SHRINK_END_FRAME, SHRINK_END_FRAME + 10], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  const fixingStatusOpacity = interpolate(
    frame,
    [fixStartFrame, fixStartFrame + STATUS_FADE_IN_FRAMES],
    [0, 1],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.out(Easing.cubic),
    },
  );
  const fixedStatusOpacity = interpolate(
    frame,
    [allFixedFrame, allFixedFrame + STATUS_FADE_IN_FRAMES],
    [0, 1],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.out(Easing.cubic),
    },
  );
  const summaryErrorCount = isAllFixed ? FIXED_ERROR_COUNT : TOTAL_ERROR_COUNT;
  const summaryFileCount = isAllFixed ? FIXED_FILE_COUNT : AFFECTED_FILE_COUNT;
  const summaryElapsedTime = isAllFixed ? FIXED_ELAPSED_TIME : ELAPSED_TIME;
  const summaryPrimaryColor = isAllFixed ? GREEN_COLOR : RED_COLOR;

  const diagnosticsStartFrame = ERRORS_START_DELAY_FRAMES;

  const overlayOpacity = interpolate(
    frame,
    [
      OVERLAY_START_FRAME,
      OVERLAY_START_FRAME + OVERLAY_FADE_IN_FRAMES,
      OVERLAY_END_FRAME - OVERLAY_FADE_OUT_FRAMES,
      OVERLAY_END_FRAME,
    ],
    [0, 1, 1, 0],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    },
  );

  const overlayTitleOpacity = interpolate(
    frame,
    [
      OVERLAY_START_FRAME + 5,
      OVERLAY_START_FRAME + OVERLAY_FADE_IN_FRAMES + 5,
      OVERLAY_END_FRAME - OVERLAY_FADE_OUT_FRAMES - 5,
      OVERLAY_END_FRAME - 5,
    ],
    [0, 1, 1, 0],
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
          transform: `translateY(${interpolate(shrinkProgress, [0, 1], [340, 0])}px)`,
          padding: "60px 80px",
        }}
      >
        <div
          style={{
            opacity: scoreBlockOpacity,
            display: "flex",
            gap: interpolate(shrinkProgress, [0, 1], [48, 32]),
            alignItems: "flex-start",
            marginBottom: 32,
          }}
        >
          <pre
            style={{
              color: scoreColor,
              lineHeight: 1.2,
              fontSize: faceFontSize,
              fontFamily,
              margin: 0,
            }}
          >
            {`${BOX_TOP}\n│ ${eyes} │\n│ ${mouth} │\n${BOX_BOTTOM}`}
          </pre>

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
                {currentScore}
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
                {getScoreLabel(currentScore)}
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
              <span style={{ color: scoreColor }}>{"█".repeat(filledBarCount)}</span>
              <span style={{ color: "#525252" }}>{"░".repeat(emptyBarCount)}</span>
            </div>
          </div>
        </div>

        <div
          style={{
            fontFamily,
            fontSize: SUMMARY_FONT_SIZE_PX,
            lineHeight: 1.7,
            color: TEXT_COLOR,
            opacity: summaryOpacity,
            marginBottom: 24,
          }}
        >
          <span style={{ color: summaryPrimaryColor }}>{summaryErrorCount} errors</span>
          <span style={{ color: MUTED_COLOR }}>
            {`  across ${summaryFileCount} files  in ${summaryElapsedTime}`}
          </span>
        </div>

        {isFixing && (
          <div
            style={{
              fontFamily,
              fontSize: STATUS_FONT_SIZE_PX,
              lineHeight: 1.6,
              color: MUTED_COLOR,
              opacity: fixingStatusOpacity,
              marginBottom: 12,
            }}
          >
            <span style={{ color: "white" }}>◌</span>
            {" Fixing issues with coding agent..."}
          </div>
        )}

        {isAllFixed && (
          <div
            style={{
              fontFamily,
              fontSize: STATUS_FONT_SIZE_PX,
              lineHeight: 1.6,
              color: GREEN_COLOR,
              opacity: fixedStatusOpacity,
              marginBottom: 12,
            }}
          >
            ✓ All issues fixed
          </div>
        )}

        {DIAGNOSTICS.map((diagnostic, index) => {
          const diagnosticStartFrame = diagnosticsStartFrame + index * FRAMES_PER_DIAGNOSTIC;
          const localFrame = frame - diagnosticStartFrame;
          const diagnosticOpacity = interpolate(
            localFrame,
            [0, DIAGNOSTIC_FADE_IN_FRAMES],
            [0, 1],
            {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.out(Easing.cubic),
            },
          );
          const fixFrame = fixStartFrame + index * FIX_INTERVAL_FRAMES;
          const fixProgress = interpolate(frame, [fixFrame, fixFrame + FIX_TRANSITION_FRAMES], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.out(Easing.cubic),
          });
          const didCompleteFixTransition = fixProgress > 0.5;

          return (
            <div
              key={diagnostic.message}
              style={{
                fontFamily,
                fontSize: DIAGNOSTIC_FONT_SIZE_PX,
                lineHeight: 1.7,
                color: didCompleteFixTransition ? MUTED_COLOR : TEXT_COLOR,
                whiteSpace: "pre-wrap",
                opacity: diagnosticOpacity,
                textDecoration: didCompleteFixTransition ? "line-through" : "none",
                marginBottom: 2,
              }}
            >
              <span style={{ color: didCompleteFixTransition ? GREEN_COLOR : RED_COLOR }}>
                {didCompleteFixTransition ? " ✓" : " ✗"}
              </span>
              {` ${diagnostic.message} `}
              <span style={{ color: didCompleteFixTransition ? GREEN_COLOR : RED_COLOR }}>
                ({diagnostic.count})
              </span>
            </div>
          );
        })}
      </div>

      <AbsoluteFill
        style={{
          justifyContent: "flex-end",
        }}
      >
        <div
          style={{
            width: "100%",
            height: OVERLAY_GRADIENT_HEIGHT_PX,
            background: getBottomOverlayGradient(overlayOpacity),
            display: "flex",
            justifyContent: "center",
            alignItems: "flex-end",
            padding: `0 ${OVERLAY_GRADIENT_HORIZONTAL_PADDING_PX}px ${OVERLAY_GRADIENT_BOTTOM_PADDING_PX}px`,
          }}
        >
          <div
            style={{
              fontFamily,
              fontSize: OVERLAY_TITLE_FONT_SIZE_PX,
              color: "white",
              opacity: overlayTitleOpacity,
              textAlign: "center",
              lineHeight: 1.4,
            }}
          >
            Fix with coding agent
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
