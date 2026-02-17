import {
  AbsoluteFill,
  Easing,
  interpolate,
  useCurrentFrame,
} from "remotion";
import {
  BACKGROUND_COLOR,
  BOX_BOTTOM,
  BOX_TOP,
  FACE_ART_FONT_FAMILY,
  MUTED_COLOR,
  PERFECT_SCORE,
  RED_COLOR,
  TARGET_SCORE,
} from "../constants";
import { fontFamily } from "../utils/font";

const SCORE_ANIMATION_FRAMES = 25;
const SCORE_FADE_IN_FRAMES = 10;
const SCORE_FONT_SIZE_PX = 96;
const SCORE_FACE_FONT_SIZE_PX = 72;
const SCORE_LABEL_FONT_SIZE_PX = 56;
const SCORE_BAR_FONT_SIZE_PX = 44;
const SCORE_BAR_WIDTH = 30;

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
  if (score >= 75) return ["o o", " u "];
  if (score >= 50) return ["o o", " - "];
  return ["x x", " v "];
};

export const ScoreReveal = () => {
  const frame = useCurrentFrame();

  const fadeIn = interpolate(frame, [0, SCORE_FADE_IN_FRAMES], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });

  const scoreProgress = interpolate(
    frame,
    [0, SCORE_ANIMATION_FRAMES],
    [0, 1],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.linear,
    },
  );

  const currentScore = Math.round(scoreProgress * PERFECT_SCORE);
  const scoreColor = getScoreColor(currentScore);
  const [eyes, mouth] = getDoctorFace(currentScore);
  const filledBarCount = Math.round(
    (currentScore / PERFECT_SCORE) * SCORE_BAR_WIDTH,
  );
  const emptyBarCount = SCORE_BAR_WIDTH - filledBarCount;

  return (
    <AbsoluteFill
      style={{
        backgroundColor: BACKGROUND_COLOR,
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <div
        style={{
          display: "flex",
          gap: 48,
          alignItems: "flex-start",
        }}
      >
        <pre
          style={{
            color: scoreColor,
            lineHeight: 1.2,
            fontSize: SCORE_FACE_FONT_SIZE_PX,
            fontFamily: FACE_ART_FONT_FAMILY,
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
                fontSize: SCORE_FONT_SIZE_PX,
                fontFamily,
              }}
            >
              {currentScore}
            </span>
            <span
              style={{
                color: MUTED_COLOR,
                fontSize: SCORE_LABEL_FONT_SIZE_PX,
                fontFamily,
              }}
            >
              {` / ${PERFECT_SCORE}  `}
            </span>
            <span
              style={{
                color: scoreColor,
                fontSize: SCORE_LABEL_FONT_SIZE_PX,
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
              fontSize: SCORE_BAR_FONT_SIZE_PX,
              fontFamily,
            }}
          >
            <span style={{ color: scoreColor }}>
              {"█".repeat(filledBarCount)}
            </span>
            <span style={{ color: "#525252" }}>
              {"░".repeat(emptyBarCount)}
            </span>
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
