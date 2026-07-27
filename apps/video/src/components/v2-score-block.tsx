import { EMPTY_BAR_COLOR, FONT_FAMILY, MUTED_COLOR } from "../constants";
import { getDoctorMood } from "../utils/get-doctor-mood";
import { getScoreLabel } from "../utils/get-score-label";
import {
  V2_PERFECT_SCORE,
  V2_SCORE_BADGE_BAR_HEIGHT_PX,
  V2_SCORE_BAR_WIDTH_PX,
} from "../v2-constants";
import { DoctorFace } from "./doctor-face";

export interface V2ScoreBlockProps {
  faceSize: number;
  gap: number;
  labelFontSize: number;
  numberFontSize: number;
  opacity: number;
  score: number;
  scoreColor: string;
  top: number;
  left: number;
  transitionProgress: number;
}

export const V2ScoreBlock = ({
  faceSize,
  gap,
  labelFontSize,
  left,
  numberFontSize,
  opacity,
  score,
  scoreColor,
  top,
  transitionProgress,
}: V2ScoreBlockProps) => (
  <div
    style={{
      position: "absolute",
      left,
      top,
      display: "flex",
      gap,
      alignItems: "flex-start",
      opacity,
      zIndex: 5,
    }}
  >
    <div
      style={{
        opacity: 1 - transitionProgress,
        overflow: "hidden",
        width: faceSize * (1 - transitionProgress),
      }}
    >
      <DoctorFace color={scoreColor} mood={getDoctorMood(score)} size={faceSize} />
    </div>
    <div>
      <div>
        <span
          style={{
            color: scoreColor,
            fontWeight: 500,
            fontSize: numberFontSize,
            fontFamily: FONT_FAMILY,
          }}
        >
          {score}
        </span>
        <span
          style={{
            color: MUTED_COLOR,
            fontSize: labelFontSize,
            fontFamily: FONT_FAMILY,
          }}
        >
          {` / ${V2_PERFECT_SCORE}  `}
        </span>
        <span
          style={{
            color: scoreColor,
            fontSize: labelFontSize,
            fontFamily: FONT_FAMILY,
          }}
        >
          {getScoreLabel(score)}
        </span>
      </div>
      <div
        style={{
          width: V2_SCORE_BAR_WIDTH_PX,
          height: V2_SCORE_BADGE_BAR_HEIGHT_PX,
          marginTop: 8,
          backgroundColor: EMPTY_BAR_COLOR,
        }}
      >
        <div
          style={{
            width: `${score}%`,
            height: "100%",
            backgroundColor: scoreColor,
          }}
        />
      </div>
    </div>
  </div>
);
