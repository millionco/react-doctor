import {
  BACKGROUND_COLOR,
  DIAGNOSE_CHAR_DURATION_FRAMES,
  DIAGNOSE_COMMAND,
  DIAGNOSE_COMMAND_PREFIX,
  DIAGNOSE_DONE_FADE_DURATION_FRAMES,
  DIAGNOSE_FIX_INTERVAL_FRAMES,
  DIAGNOSE_ITEM_FONT_SIZE_PX,
  DIAGNOSE_ITEM_LINE_HEIGHT,
  DIAGNOSE_LIST_INITIAL_HEIGHT_PX,
  DIAGNOSE_LIST_VERDICT_HEIGHT_PX,
  DIAGNOSE_PROMPT_FONT_SIZE_PX,
  DIAGNOSE_SCAN_FRAMES_PER_ISSUE,
  DIAGNOSE_SCAN_LEAD_FRAMES,
  DIAGNOSE_SCORE_ANIMATION_DURATION_FRAMES,
  DIAGNOSE_SCORE_FADE_DURATION_FRAMES,
  DIAGNOSE_SPINNER_DURATION_FRAMES,
  DIAGNOSE_TYPING_DELAY_FRAMES,
  DIAGNOSE_TYPING_POST_PAUSE_FRAMES,
  DIAGNOSE_VERDICT_DELAY_FRAMES,
  DIAGNOSE_VERDICT_HOLD_FRAMES,
  DIAGNOSE_VERDICT_ZOOM_DURATION_FRAMES,
  DIAGNOSE_VERDICT_ZOOM_SCALE,
  DIAGNOSE_ZOOMED_PROMPT_FONT_SIZE_PX,
  DIAGNOSE_ZOOM_OUT_DURATION_FRAMES,
  DIAGNOSE_ZOOM_SCALE,
  DIAGNOSTICS,
  PERFECT_SCORE,
  SPINNER_CHARACTERS,
  TARGET_SCORE,
} from "../constants";
import { DiagnoseHeader } from "../components/diagnose-header";
import { DiagnoseList } from "../components/diagnose-list";
import { DiagnoseScore } from "../components/diagnose-score";
import { DiagnoseStatus } from "../components/diagnose-status";
import { easeInOutQuadratic } from "../utils/ease-in-out-quadratic";
import { easeOutCubic } from "../utils/ease-out-cubic";
import { getCursorOpacity } from "../utils/get-cursor-opacity";
import { getScoreColor } from "../utils/get-score-color";
import { interpolateNumber } from "../utils/interpolate-number";

export interface DiagnoseAndFixProps {
  frame: number;
}

const typingEndFrame =
  DIAGNOSE_TYPING_DELAY_FRAMES +
  DIAGNOSE_COMMAND.length * DIAGNOSE_CHAR_DURATION_FRAMES +
  DIAGNOSE_TYPING_POST_PAUSE_FRAMES;
const zoomOutEndFrame = typingEndFrame + DIAGNOSE_ZOOM_OUT_DURATION_FRAMES;
const scanStartFrame = zoomOutEndFrame - DIAGNOSE_SCAN_LEAD_FRAMES;
const scanEndFrame = scanStartFrame + DIAGNOSTICS.length * DIAGNOSE_SCAN_FRAMES_PER_ISSUE;
const verdictAppearFrame = scanEndFrame + DIAGNOSE_VERDICT_DELAY_FRAMES;
const fixStartFrame = verdictAppearFrame + DIAGNOSE_VERDICT_HOLD_FRAMES;
const allFixedFrame = fixStartFrame + DIAGNOSTICS.length * DIAGNOSE_FIX_INTERVAL_FRAMES;
const itemRowHeightPixels = DIAGNOSE_ITEM_FONT_SIZE_PX * DIAGNOSE_ITEM_LINE_HEIGHT + 8;
const maximumScrollPixels = Math.max(
  0,
  DIAGNOSTICS.length * itemRowHeightPixels - DIAGNOSE_LIST_INITIAL_HEIGHT_PX,
);

export const DiagnoseAndFix = ({ frame }: DiagnoseAndFixProps) => {
  const typedCharacterCount = Math.min(
    DIAGNOSE_COMMAND.length,
    Math.max(0, Math.floor((frame - DIAGNOSE_TYPING_DELAY_FRAMES) / DIAGNOSE_CHAR_DURATION_FRAMES)),
  );
  const isTypingActive =
    frame >= DIAGNOSE_TYPING_DELAY_FRAMES && typedCharacterCount < DIAGNOSE_COMMAND.length;
  const cursorOpacity = getCursorOpacity({ frame, isTypingActive });
  const initialZoom =
    frame <= typingEndFrame
      ? DIAGNOSE_ZOOM_SCALE
      : interpolateNumber({
          value: frame,
          inputStart: typingEndFrame,
          inputEnd: zoomOutEndFrame,
          outputStart: DIAGNOSE_ZOOM_SCALE,
          outputEnd: 1,
          easing: easeInOutQuadratic,
        });
  const verdictZoom = interpolateNumber({
    value: frame,
    inputStart: verdictAppearFrame,
    inputEnd: verdictAppearFrame + DIAGNOSE_VERDICT_ZOOM_DURATION_FRAMES,
    outputStart: 1,
    outputEnd: DIAGNOSE_VERDICT_ZOOM_SCALE,
    easing: easeInOutQuadratic,
  });
  const zoomProgress = interpolateNumber({
    value: frame,
    inputStart: typingEndFrame,
    inputEnd: zoomOutEndFrame,
    outputStart: 0,
    outputEnd: 1,
    easing: easeInOutQuadratic,
  });
  const promptFontSize = interpolateNumber({
    value: zoomProgress,
    inputStart: 0,
    inputEnd: 1,
    outputStart: DIAGNOSE_ZOOMED_PROMPT_FONT_SIZE_PX,
    outputEnd: DIAGNOSE_PROMPT_FONT_SIZE_PX,
  });
  const spinnerCharacter =
    SPINNER_CHARACTERS[
      Math.floor(frame / DIAGNOSE_SPINNER_DURATION_FRAMES) % SPINNER_CHARACTERS.length
    ];
  const fixedIssueCount = Math.max(
    0,
    Math.min(
      DIAGNOSTICS.length,
      Math.floor((frame - fixStartFrame) / DIAGNOSE_FIX_INTERVAL_FRAMES) + 1,
    ),
  );
  const isScanning = frame >= scanStartFrame && frame < verdictAppearFrame;
  const isVerdictVisible = frame >= verdictAppearFrame && frame < fixStartFrame;
  const isFixing = frame >= fixStartFrame;
  const allFixed = fixedIssueCount >= DIAGNOSTICS.length;
  const listOpacity = interpolateNumber({
    value: frame,
    inputStart: scanStartFrame,
    inputEnd: scanStartFrame + 12,
    outputStart: 0,
    outputEnd: 1,
    easing: easeOutCubic,
  });
  const listHeight = interpolateNumber({
    value: frame,
    inputStart: verdictAppearFrame,
    inputEnd: verdictAppearFrame + 10,
    outputStart: DIAGNOSE_LIST_INITIAL_HEIGHT_PX,
    outputEnd: DIAGNOSE_LIST_VERDICT_HEIGHT_PX,
    easing: easeInOutQuadratic,
  });
  const listScrollY = interpolateNumber({
    value: frame,
    inputStart: scanStartFrame,
    inputEnd: scanEndFrame,
    outputStart: 0,
    outputEnd: maximumScrollPixels,
  });
  const verdictOpacity = interpolateNumber({
    value: frame,
    inputStart: verdictAppearFrame,
    inputEnd: verdictAppearFrame + 8,
    outputStart: 0,
    outputEnd: 1,
    easing: easeOutCubic,
  });
  const doneOpacity = interpolateNumber({
    value: frame,
    inputStart: allFixedFrame,
    inputEnd: allFixedFrame + DIAGNOSE_DONE_FADE_DURATION_FRAMES,
    outputStart: 0,
    outputEnd: 1,
    easing: easeOutCubic,
  });
  const scoreOpacity = interpolateNumber({
    value: frame,
    inputStart: verdictAppearFrame,
    inputEnd: verdictAppearFrame + DIAGNOSE_SCORE_FADE_DURATION_FRAMES,
    outputStart: 0,
    outputEnd: 1,
    easing: easeOutCubic,
  });
  let displayScore = Math.round(
    interpolateNumber({
      value: frame,
      inputStart: verdictAppearFrame,
      inputEnd: verdictAppearFrame + DIAGNOSE_SCORE_ANIMATION_DURATION_FRAMES,
      outputStart: 0,
      outputEnd: TARGET_SCORE,
      easing: easeOutCubic,
    }),
  );
  if (isFixing) {
    displayScore =
      TARGET_SCORE +
      Math.round((PERFECT_SCORE - TARGET_SCORE) * (fixedIssueCount / DIAGNOSTICS.length));
  }
  const scoreColor = getScoreColor(displayScore);
  const slashCommandCharacterCount = Math.min(typedCharacterCount, DIAGNOSE_COMMAND_PREFIX.length);
  const remainingCharacterCount = Math.max(0, typedCharacterCount - DIAGNOSE_COMMAND_PREFIX.length);
  const slashCommandText = DIAGNOSE_COMMAND_PREFIX.slice(0, slashCommandCharacterCount);
  const remainingText = DIAGNOSE_COMMAND.slice(
    DIAGNOSE_COMMAND_PREFIX.length,
    DIAGNOSE_COMMAND_PREFIX.length + remainingCharacterCount,
  );
  const grayscale = interpolateNumber({
    value: frame,
    inputStart: verdictAppearFrame,
    inputEnd: verdictAppearFrame + 8,
    outputStart: 1,
    outputEnd: 0,
  });

  return (
    <div className="scene" style={{ backgroundColor: BACKGROUND_COLOR }}>
      <div
        style={{
          width: "100%",
          height: "100%",
          transform: `scale(${initialZoom * verdictZoom})`,
          transformOrigin: `0% ${interpolateNumber({
            value: frame,
            inputStart: verdictAppearFrame,
            inputEnd: verdictAppearFrame + DIAGNOSE_VERDICT_ZOOM_DURATION_FRAMES,
            outputStart: 0,
            outputEnd: 100,
            easing: easeInOutQuadratic,
          })}%`,
        }}
      >
        <DiagnoseHeader
          cursorOpacity={cursorOpacity}
          frame={frame}
          promptFontSize={promptFontSize}
          remainingText={remainingText}
          slashCommandText={slashCommandText}
          zoomOutEndFrame={zoomOutEndFrame}
        />
        <DiagnoseStatus
          allFixed={allFixed}
          doneOpacity={doneOpacity}
          isFixing={isFixing}
          isScanning={isScanning}
          isVerdictVisible={isVerdictVisible}
          issueCount={DIAGNOSTICS.length}
          listOpacity={listOpacity}
          spinnerCharacter={spinnerCharacter}
          verdictOpacity={verdictOpacity}
        />
        <DiagnoseList
          fixedIssueCount={fixedIssueCount}
          fixStartFrame={fixStartFrame}
          frame={frame}
          grayscale={grayscale}
          height={listHeight}
          isFixing={isFixing}
          opacity={listOpacity}
          scrollY={listScrollY}
        />
        <DiagnoseScore displayScore={displayScore} opacity={scoreOpacity} scoreColor={scoreColor} />
      </div>
    </div>
  );
};
