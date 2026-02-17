import { highlighter } from "./highlighter.js";
import { stripAnsi } from "./strip-ansi.js";
import type { LoggerCaptureState } from "../types.js";

const loggerCaptureState: LoggerCaptureState = {
  isEnabled: false,
  lines: [],
};

const captureLogLine = (text: string): void => {
  if (!loggerCaptureState.isEnabled) {
    return;
  }

  loggerCaptureState.lines.push(stripAnsi(text));
};

const writeLogLine = (text: string): void => {
  console.log(text);
  captureLogLine(text);
};

export const startLoggerCapture = (): void => {
  loggerCaptureState.isEnabled = true;
  loggerCaptureState.lines = [];
};

export const stopLoggerCapture = (): string => {
  const capturedOutput = loggerCaptureState.lines.join("\n");
  loggerCaptureState.isEnabled = false;
  loggerCaptureState.lines = [];
  return capturedOutput;
};

export const logger = {
  error(...args: unknown[]) {
    writeLogLine(highlighter.error(args.join(" ")));
  },
  warn(...args: unknown[]) {
    writeLogLine(highlighter.warn(args.join(" ")));
  },
  info(...args: unknown[]) {
    writeLogLine(highlighter.info(args.join(" ")));
  },
  success(...args: unknown[]) {
    writeLogLine(highlighter.success(args.join(" ")));
  },
  dim(...args: unknown[]) {
    writeLogLine(highlighter.dim(args.join(" ")));
  },
  log(...args: unknown[]) {
    writeLogLine(args.join(" "));
  },
  break() {
    writeLogLine("");
  },
};
