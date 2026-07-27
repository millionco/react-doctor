import { CURSOR_BLINK_DURATION_FRAMES } from "../constants";
import { interpolateNumber } from "./interpolate-number";

export interface GetCursorOpacityInput {
  frame: number;
  isTypingActive: boolean;
}

export const getCursorOpacity = ({ frame, isTypingActive }: GetCursorOpacityInput) => {
  if (isTypingActive) return 1;
  const cursorFrame = frame % CURSOR_BLINK_DURATION_FRAMES;
  const halfDuration = CURSOR_BLINK_DURATION_FRAMES / 2;
  if (cursorFrame <= halfDuration) {
    return interpolateNumber({
      value: cursorFrame,
      inputStart: 0,
      inputEnd: halfDuration,
      outputStart: 1,
      outputEnd: 0,
    });
  }
  return interpolateNumber({
    value: cursorFrame,
    inputStart: halfDuration,
    inputEnd: CURSOR_BLINK_DURATION_FRAMES,
    outputStart: 0,
    outputEnd: 1,
  });
};
