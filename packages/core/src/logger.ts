import { highlighter } from "./highlighter.js";

/**
 * Logger contract. Side-effect functions that print to the host
 * terminal (or test capture, or LSP output channel). Methods take
 * varargs joined by " " to match the legacy module-level helper
 * `logger` exported by this file before the Logger service landed.
 *
 * Use `consoleLogger` for production; `silentLogger` for `--silent`;
 * inside Effect code, yield the `Logger` service instead so the
 * caller's layer choice decides the implementation. Plain functions
 * that take a logger parameter type it as `LoggerWriter`.
 */
export interface LoggerWriter {
  log: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  success: (...args: unknown[]) => void;
  dim: (...args: unknown[]) => void;
  break: () => void;
}

export const consoleLogger: LoggerWriter = {
  log: (...args) => console.log(args.join(" ")),
  error: (...args) => console.error(highlighter.error(args.join(" "))),
  warn: (...args) => console.warn(highlighter.warn(args.join(" "))),
  info: (...args) => console.log(highlighter.info(args.join(" "))),
  success: (...args) => console.log(highlighter.success(args.join(" "))),
  dim: (...args) => console.log(highlighter.dim(args.join(" "))),
  break: () => console.log(""),
};

export const silentLogger: LoggerWriter = {
  log: () => {},
  error: () => {},
  warn: () => {},
  info: () => {},
  success: () => {},
  dim: () => {},
  break: () => {},
};

/**
 * Registry-pattern facade for callers that haven't been converted to
 * accept a Logger parameter or yield the Logger service yet. Swaps
 * between consoleLogger (default) and silentLogger via the legacy
 * `setLoggerSilent` helper. Effect-aware code should yield the Logger
 * service instead — the registry is for non-Effect callers only.
 *
 * @deprecated Prefer passing a Logger parameter or yielding the
 * Logger service. The registry will be removed once every caller is
 * Logger-aware.
 */
let currentLogger: LoggerWriter = consoleLogger;

export const logger: LoggerWriter = {
  log: (...args) => currentLogger.log(...args),
  error: (...args) => currentLogger.error(...args),
  warn: (...args) => currentLogger.warn(...args),
  info: (...args) => currentLogger.info(...args),
  success: (...args) => currentLogger.success(...args),
  dim: (...args) => currentLogger.dim(...args),
  break: () => currentLogger.break(),
};

/** @deprecated use Logger service via Effect or pass a Logger parameter */
export const setLoggerSilent = (silent: boolean): void => {
  currentLogger = silent ? silentLogger : consoleLogger;
};

/** @deprecated use Logger service */
export const isLoggerSilent = (): boolean => currentLogger === silentLogger;
