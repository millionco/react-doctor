import {
  DIAGNOSE_BADGE_BAR_HEIGHT_PX,
  DIAGNOSE_BADGE_BAR_WIDTH_PX,
  DIAGNOSE_BADGE_LABEL_FONT_SIZE_PX,
  DIAGNOSE_BADGE_LEFT_PX,
  DIAGNOSE_BADGE_NUMBER_FONT_SIZE_PX,
  DIAGNOSE_BADGE_TOP_PX,
  EMPTY_BAR_COLOR,
  FONT_FAMILY,
  MUTED_COLOR,
  PERFECT_SCORE,
} from "../constants";
import { getScoreLabel } from "../utils/get-score-label";

export interface DiagnoseScoreProps {
  displayScore: number;
  opacity: number;
  scoreColor: string;
}

export const DiagnoseScore = ({ displayScore, opacity, scoreColor }: DiagnoseScoreProps) => (
  <div
    style={{
      position: "absolute",
      left: DIAGNOSE_BADGE_LEFT_PX,
      top: DIAGNOSE_BADGE_TOP_PX,
      opacity,
    }}
  >
    <div>
      <span
        style={{
          color: scoreColor,
          fontWeight: 500,
          fontSize: DIAGNOSE_BADGE_NUMBER_FONT_SIZE_PX,
          fontFamily: FONT_FAMILY,
        }}
      >
        {displayScore}
      </span>
      <span
        style={{
          color: MUTED_COLOR,
          fontSize: DIAGNOSE_BADGE_LABEL_FONT_SIZE_PX,
          fontFamily: FONT_FAMILY,
        }}
      >
        {` / ${PERFECT_SCORE}  `}
      </span>
      <span
        style={{
          color: scoreColor,
          fontSize: DIAGNOSE_BADGE_LABEL_FONT_SIZE_PX,
          fontFamily: FONT_FAMILY,
        }}
      >
        {getScoreLabel(displayScore)}
      </span>
    </div>
    <div
      style={{
        width: DIAGNOSE_BADGE_BAR_WIDTH_PX,
        height: DIAGNOSE_BADGE_BAR_HEIGHT_PX,
        marginTop: 8,
        backgroundColor: EMPTY_BAR_COLOR,
      }}
    >
      <div
        style={{
          width: `${(displayScore / PERFECT_SCORE) * 100}%`,
          height: "100%",
          backgroundColor: scoreColor,
        }}
      />
    </div>
  </div>
);
