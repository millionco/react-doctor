import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
} from "remotion";
import {
  BACKGROUND_COLOR,
  CHAR_FRAMES,
  COMMAND,
  CURSOR_BLINK_FRAMES,
  MUTED_COLOR,
  TEXT_COLOR,
  TYPING_FONT_SIZE_PX,
  TYPING_INITIAL_DELAY_FRAMES,
  VIDEO_SPEED_MULTIPLIER,
} from "../constants";
import { fontFamily } from "../utils/font";

export const TerminalTyping = () => {
  const frame = useCurrentFrame() * VIDEO_SPEED_MULTIPLIER;

  const typedCharCount = Math.min(
    COMMAND.length,
    Math.max(
      0,
      Math.floor((frame - TYPING_INITIAL_DELAY_FRAMES) / CHAR_FRAMES),
    ),
  );
  const typedCommand = COMMAND.slice(0, typedCharCount);
  const isTypingDone = typedCharCount >= COMMAND.length;
  const isTypingActive =
    frame >= TYPING_INITIAL_DELAY_FRAMES && !isTypingDone;

  const cursorOpacity = isTypingActive
    ? 1
    : interpolate(
        frame % CURSOR_BLINK_FRAMES,
        [0, CURSOR_BLINK_FRAMES / 2, CURSOR_BLINK_FRAMES],
        [1, 0, 1],
        { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
      );

  return (
    <AbsoluteFill
      style={{
        backgroundColor: BACKGROUND_COLOR,
        justifyContent: "center",
        padding: "0 80px",
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
  );
};
