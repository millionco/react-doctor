import {
  AbsoluteFill,
  Easing,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import {
  BACKGROUND_COLOR,
  GREEN_COLOR,
  IMPROVED_SCORE,
  MUTED_COLOR,
  PERFECT_SCORE,
  SCORE_GOOD_THRESHOLD,
  SCORE_OK_THRESHOLD,
  YELLOW_COLOR,
} from "../constants";
import { fontFamily } from "../utils/font";

const FACE_FONT_SIZE_PX = 72;
const SCORE_FONT_SIZE_PX = 160;
const LABEL_FONT_SIZE_PX = 56;
const BAR_FONT_SIZE_PX = 44;
const PACKAGE_FONT_SIZE_PX = 32;
const SCORE_BAR_WIDTH = 30;

const BOX_TOP = "┌─────┐";
const BOX_BOTTOM = "└─────┘";

const getScoreColor = (score: number) => {
  if (score >= SCORE_GOOD_THRESHOLD) return GREEN_COLOR;
  if (score >= SCORE_OK_THRESHOLD) return YELLOW_COLOR;
  return "#f87171";
};

const getDoctorFace = (score: number): [string, string] => {
  if (score >= SCORE_GOOD_THRESHOLD) return ["◠ ◠", " ▽ "];
  if (score >= SCORE_OK_THRESHOLD) return ["• •", " ─ "];
  return ["x x", " ▽ "];
};

export const ScoreReveal = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const scoreColor = getScoreColor(IMPROVED_SCORE);
  const [eyes, mouth] = getDoctorFace(IMPROVED_SCORE);
  const filledBarCount = Math.round((IMPROVED_SCORE / PERFECT_SCORE) * SCORE_BAR_WIDTH);
  const emptyBarCount = SCORE_BAR_WIDTH - filledBarCount;

  const barOpacity = interpolate(frame, [12, 20], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });

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
            fontSize: FACE_FONT_SIZE_PX,
            fontFamily,
            margin: 0,
          }}
        >
          {`${BOX_TOP}\n│ ${eyes} │\n│ ${mouth} │\n${BOX_BOTTOM}`}
        </pre>

        <div>
          <div
            style={{
              fontFamily,
              fontSize: PACKAGE_FONT_SIZE_PX,
              color: MUTED_COLOR,
              marginBottom: 4,
            }}
          >
            @calcom/web
          </div>
          <div>
            <span
              style={{
                color: scoreColor,
                fontWeight: 600,
                fontSize: SCORE_FONT_SIZE_PX,
                fontFamily,
              }}
            >
              {IMPROVED_SCORE}
            </span>
            <span style={{ color: MUTED_COLOR, fontSize: LABEL_FONT_SIZE_PX, fontFamily }}>
              {` / ${PERFECT_SCORE}  `}
            </span>
            <span style={{ color: scoreColor, fontSize: LABEL_FONT_SIZE_PX, fontFamily }}>
              Great
            </span>
          </div>
          <div
            style={{
              marginTop: 8,
              letterSpacing: 2,
              fontSize: BAR_FONT_SIZE_PX,
              fontFamily,
              opacity: barOpacity,
            }}
          >
            <span style={{ color: scoreColor }}>{"█".repeat(filledBarCount)}</span>
            <span style={{ color: "#525252" }}>{"░".repeat(emptyBarCount)}</span>
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
