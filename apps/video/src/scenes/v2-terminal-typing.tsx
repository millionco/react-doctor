import { BACKGROUND_COLOR, FONT_FAMILY, MUTED_COLOR, TEXT_COLOR, WHITE_COLOR } from "../constants";
import { V2ScanBackground } from "../components/v2-scan-background";
import { easeOutCubic } from "../utils/ease-out-cubic";
import { getCursorOpacity } from "../utils/get-cursor-opacity";
import { interpolateNumber } from "../utils/interpolate-number";
import {
  V2_COMMAND,
  V2_SCAN_FONT_SIZE_PX,
  V2_SCAN_LINE_HEIGHT,
  V2_SCAN_ROW_VERTICAL_PADDING_PX,
  V2_SCAN_SCROLL_DISTANCE_RATIO,
  V2_SCAN_SCROLL_REFERENCE_FRAMES,
  V2_SCANNED_ISSUES,
  V2_TYPING_BACKGROUND_FADE_DURATION_FRAMES,
  V2_TYPING_BACKGROUND_FADE_START_FRAME,
  V2_TYPING_BACKGROUND_OPACITY,
  V2_TYPING_CONTENT_LEFT_PADDING_PX,
  V2_TYPING_CONTENT_RIGHT_PADDING_PX,
  V2_TYPING_DELAY_FRAMES,
  V2_TYPING_FONT_SIZE_PX,
} from "../v2-constants";

export interface V2TerminalTypingProps {
  frame: number;
}

const scanRowHeightPixels =
  V2_SCAN_FONT_SIZE_PX * V2_SCAN_LINE_HEIGHT + V2_SCAN_ROW_VERTICAL_PADDING_PX * 2;
const scanHeightPixels = V2_SCANNED_ISSUES.length * scanRowHeightPixels;
const scanScrollPixelsPerFrame =
  (scanHeightPixels * V2_SCAN_SCROLL_DISTANCE_RATIO) / V2_SCAN_SCROLL_REFERENCE_FRAMES;

export const V2TerminalTyping = ({ frame }: V2TerminalTypingProps) => {
  const typedCharacterCount = Math.min(
    V2_COMMAND.length,
    Math.max(0, Math.floor(frame - V2_TYPING_DELAY_FRAMES)),
  );
  const isTypingActive = frame >= V2_TYPING_DELAY_FRAMES && typedCharacterCount < V2_COMMAND.length;
  const backgroundOpacity = interpolateNumber({
    value: frame,
    inputStart: V2_TYPING_BACKGROUND_FADE_START_FRAME,
    inputEnd: V2_TYPING_BACKGROUND_FADE_START_FRAME + V2_TYPING_BACKGROUND_FADE_DURATION_FRAMES,
    outputStart: 0,
    outputEnd: V2_TYPING_BACKGROUND_OPACITY,
    easing: easeOutCubic,
  });
  const backgroundScrollY = Math.max(
    0,
    (frame - V2_TYPING_BACKGROUND_FADE_START_FRAME) * scanScrollPixelsPerFrame,
  );

  return (
    <div className="scene" style={{ backgroundColor: BACKGROUND_COLOR }}>
      <V2ScanBackground opacity={backgroundOpacity} scrollY={backgroundScrollY} />
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          justifyContent: "center",
          flexDirection: "column",
          padding: `0 ${V2_TYPING_CONTENT_RIGHT_PADDING_PX}px 0 ${V2_TYPING_CONTENT_LEFT_PADDING_PX}px`,
        }}
      >
        <div
          style={{
            fontFamily: FONT_FAMILY,
            fontSize: V2_TYPING_FONT_SIZE_PX,
            lineHeight: 1.7,
            color: TEXT_COLOR,
            whiteSpace: "nowrap",
          }}
        >
          <span style={{ color: MUTED_COLOR }}>$ </span>
          <span style={{ color: WHITE_COLOR }}>{V2_COMMAND.slice(0, typedCharacterCount)}</span>
          <span style={{ opacity: getCursorOpacity({ frame, isTypingActive }) }}>▋</span>
        </div>
      </div>
    </div>
  );
};
