import type { V8ProfileCallFrame } from "./types.ts";

export const profileFrameKey = (callFrame: V8ProfileCallFrame): string =>
  [
    callFrame.functionName || "(anonymous)",
    callFrame.url,
    String(callFrame.lineNumber),
    String(callFrame.columnNumber),
  ].join("::");
