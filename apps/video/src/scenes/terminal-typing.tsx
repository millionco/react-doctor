import {
  BACKGROUND_COLOR,
  COMMAND,
  FONT_FAMILY,
  MUTED_COLOR,
  TERMINAL_CONTENT_LEFT_PADDING_PX,
  TERMINAL_CONTENT_RIGHT_PADDING_PX,
  TERMINAL_TYPING_CHAR_DURATION_FRAMES,
  TERMINAL_TYPING_DELAY_FRAMES,
  TERMINAL_TYPING_FONT_SIZE_PX,
  TEXT_COLOR,
  WHITE_COLOR,
} from "../constants";
import { getCursorOpacity } from "../utils/get-cursor-opacity";

export interface TerminalTypingProps {
  frame: number;
}

export const TerminalTyping = ({ frame }: TerminalTypingProps) => {
  const typedCharacterCount = Math.min(
    COMMAND.length,
    Math.max(
      0,
      Math.floor((frame - TERMINAL_TYPING_DELAY_FRAMES) / TERMINAL_TYPING_CHAR_DURATION_FRAMES),
    ),
  );
  const isTypingActive =
    frame >= TERMINAL_TYPING_DELAY_FRAMES && typedCharacterCount < COMMAND.length;

  return (
    <div
      className="scene"
      style={{
        display: "flex",
        justifyContent: "center",
        flexDirection: "column",
        padding: `0 ${TERMINAL_CONTENT_RIGHT_PADDING_PX}px 0 ${TERMINAL_CONTENT_LEFT_PADDING_PX}px`,
        backgroundColor: BACKGROUND_COLOR,
      }}
    >
      <div
        style={{
          fontFamily: FONT_FAMILY,
          fontSize: TERMINAL_TYPING_FONT_SIZE_PX,
          lineHeight: 1.7,
          color: TEXT_COLOR,
          whiteSpace: "nowrap",
        }}
      >
        <span style={{ color: MUTED_COLOR }}>$ </span>
        <span style={{ color: WHITE_COLOR }}>{COMMAND.slice(0, typedCharacterCount)}</span>
        <span
          style={{
            opacity: getCursorOpacity({ frame, isTypingActive }),
          }}
        >
          ▋
        </span>
      </div>
    </div>
  );
};
