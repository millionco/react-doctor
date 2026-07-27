import { BACKGROUND_COLOR } from "../constants";
import { V2ClaudeInterface } from "../components/v2-claude-interface";
import { V2ScanBackground } from "../components/v2-scan-background";
import { V2ScoreBlock } from "../components/v2-score-block";
import { easeInOutCubic } from "../utils/ease-in-out-cubic";
import { easeOutCubic } from "../utils/ease-out-cubic";
import { getScoreColor } from "../utils/get-score-color";
import { interpolateNumber } from "../utils/interpolate-number";
import {
  V2_CLAUDE_FIX_INTERVAL_FRAMES,
  V2_CLAUDE_FIX_START_FRAME,
  V2_CLAUDE_SPINNER_DURATION_FRAMES,
  V2_DIAGNOSTICS,
  V2_FILE_SCAN_DURATION_FRAMES,
  V2_SCAN_FONT_SIZE_PX,
  V2_SCAN_LINE_HEIGHT,
  V2_SCAN_ROW_VERTICAL_PADDING_PX,
  V2_SCAN_SCROLL_DISTANCE_RATIO,
  V2_SCAN_SCROLL_REFERENCE_FRAMES,
  V2_SCANNED_ISSUES,
  V2_SCORE_ANIMATION_DURATION_FRAMES,
  V2_SCORE_BADGE_LABEL_FONT_SIZE_PX,
  V2_SCORE_BADGE_LEFT_PX,
  V2_SCORE_BADGE_NUMBER_FONT_SIZE_PX,
  V2_SCORE_BADGE_TOP_PX,
  V2_SCORE_HERO_HOLD_END_FRAME,
  V2_SCORE_HERO_LEFT_PX,
  V2_SCORE_HERO_TOP_PX,
  V2_SCORE_LABEL_FONT_SIZE_PX,
  V2_SCORE_NUMBER_FONT_SIZE_PX,
  V2_SCORE_FACE_SIZE_PX,
  V2_SCORE_TRANSITION_END_FRAME,
  V2_TYPING_BACKGROUND_OPACITY,
  V2_HERO_SCORE,
} from "../v2-constants";
import { SPINNER_CHARACTERS } from "../constants";

export interface V2DiagnoseAndFixProps {
  frame: number;
}

const scanRowHeightPixels =
  V2_SCAN_FONT_SIZE_PX * V2_SCAN_LINE_HEIGHT + V2_SCAN_ROW_VERTICAL_PADDING_PX * 2;
const scanHeightPixels = V2_SCANNED_ISSUES.length * scanRowHeightPixels;
const scanScrollPixelsPerFrame =
  (scanHeightPixels * V2_SCAN_SCROLL_DISTANCE_RATIO) / V2_SCAN_SCROLL_REFERENCE_FRAMES;
const scanEndScrollPixels = V2_FILE_SCAN_DURATION_FRAMES * scanScrollPixelsPerFrame;

export const V2DiagnoseAndFix = ({ frame }: V2DiagnoseAndFixProps) => {
  const transitionProgress = interpolateNumber({
    value: frame,
    inputStart: V2_SCORE_HERO_HOLD_END_FRAME,
    inputEnd: V2_SCORE_TRANSITION_END_FRAME,
    outputStart: 0,
    outputEnd: 1,
    easing: easeInOutCubic,
  });
  const fixedDiagnosticCount = Math.max(
    0,
    Math.min(
      V2_DIAGNOSTICS.length,
      Math.floor((frame - V2_CLAUDE_FIX_START_FRAME) / V2_CLAUDE_FIX_INTERVAL_FRAMES) + 1,
    ),
  );
  const isFixing = frame >= V2_CLAUDE_FIX_START_FRAME;
  const allFixed = fixedDiagnosticCount >= V2_DIAGNOSTICS.length;
  const allFixedFrame =
    V2_CLAUDE_FIX_START_FRAME + V2_DIAGNOSTICS.length * V2_CLAUDE_FIX_INTERVAL_FRAMES;
  const score = Math.round(
    interpolateNumber({
      value: frame,
      inputStart: 0,
      inputEnd: V2_SCORE_ANIMATION_DURATION_FRAMES,
      outputStart: 0,
      outputEnd: V2_HERO_SCORE,
      easing: easeOutCubic,
    }),
  );
  const scoreOpacity = interpolateNumber({
    value: frame,
    inputStart: 0,
    inputEnd: 8,
    outputStart: 0,
    outputEnd: 1,
    easing: easeOutCubic,
  });
  const backgroundOpacity =
    V2_TYPING_BACKGROUND_OPACITY *
    interpolateNumber({
      value: frame,
      inputStart: V2_SCORE_HERO_HOLD_END_FRAME,
      inputEnd: V2_SCORE_TRANSITION_END_FRAME,
      outputStart: 1,
      outputEnd: 0,
    });
  const interpolateLayout = (heroValue: number, badgeValue: number) =>
    interpolateNumber({
      value: transitionProgress,
      inputStart: 0,
      inputEnd: 1,
      outputStart: heroValue,
      outputEnd: badgeValue,
    });

  return (
    <div className="scene" style={{ backgroundColor: BACKGROUND_COLOR }}>
      <V2ScanBackground
        opacity={backgroundOpacity}
        repeatCount={3}
        scrollY={scanEndScrollPixels + frame * scanScrollPixelsPerFrame}
      />
      <V2ClaudeInterface
        allFixed={allFixed}
        allFixedFrame={allFixedFrame}
        fixedDiagnosticCount={fixedDiagnosticCount}
        frame={frame}
        isFixing={isFixing}
        spinnerCharacter={
          SPINNER_CHARACTERS[
            Math.floor(frame / V2_CLAUDE_SPINNER_DURATION_FRAMES) % SPINNER_CHARACTERS.length
          ]
        }
      />
      <V2ScoreBlock
        faceSize={V2_SCORE_FACE_SIZE_PX * (1 - transitionProgress)}
        gap={interpolateLayout(48, 16)}
        labelFontSize={interpolateLayout(
          V2_SCORE_LABEL_FONT_SIZE_PX,
          V2_SCORE_BADGE_LABEL_FONT_SIZE_PX,
        )}
        left={interpolateLayout(V2_SCORE_HERO_LEFT_PX, V2_SCORE_BADGE_LEFT_PX)}
        numberFontSize={interpolateLayout(
          V2_SCORE_NUMBER_FONT_SIZE_PX,
          V2_SCORE_BADGE_NUMBER_FONT_SIZE_PX,
        )}
        opacity={scoreOpacity}
        score={score}
        scoreColor={getScoreColor(score)}
        top={interpolateLayout(V2_SCORE_HERO_TOP_PX, V2_SCORE_BADGE_TOP_PX)}
        transitionProgress={transitionProgress}
      />
    </div>
  );
};
