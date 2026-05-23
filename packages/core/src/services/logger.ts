import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import { consoleLogger, silentLogger, type LoggerWriter } from "../logger.js";

/**
 * Captured Logger events backing `Logger.layerCapture`. One entry per
 * `log/error/warn/info/success/dim/break` call. Tests `yield*
 * LoggerCapture` to read the recorded events and assert on what the
 * pipeline would have printed.
 */
export interface LoggerEvent {
  readonly level: "log" | "error" | "warn" | "info" | "success" | "dim" | "break";
  readonly message: string;
}

export class LoggerCapture extends Context.Service<
  LoggerCapture,
  Ref.Ref<ReadonlyArray<LoggerEvent>>
>()("react-doctor/LoggerCapture") {
  static readonly layer = Layer.effect(LoggerCapture, Ref.make<ReadonlyArray<LoggerEvent>>([]));
}

const recordCapture =
  (events: Ref.Ref<ReadonlyArray<LoggerEvent>>, level: LoggerEvent["level"]) =>
  (...args: unknown[]): void => {
    Effect.runSync(
      Ref.update(events, (existing) => [...existing, { level, message: args.join(" ") }]),
    );
  };

/**
 * `Logger` is the terminal-output service. Production picks
 * `layerConsole` or `layerSilent` based on `--silent`; tests use
 * `layerCapture` to record events into a `Ref` without touching
 * stdout/stderr. An LSP host would provide a fourth layer that
 * routes through `connection.window.showMessage` instead of
 * console.
 */
export class Logger extends Context.Service<Logger, LoggerWriter>()("react-doctor/Logger") {
  static readonly layerConsole: Layer.Layer<Logger> = Layer.succeed(Logger, consoleLogger);

  static readonly layerSilent: Layer.Layer<Logger> = Layer.succeed(Logger, silentLogger);

  static readonly layerCapture: Layer.Layer<Logger | LoggerCapture> = Layer.effect(
    Logger,
    Effect.map(
      LoggerCapture,
      (events): LoggerWriter => ({
        log: recordCapture(events, "log"),
        error: recordCapture(events, "error"),
        warn: recordCapture(events, "warn"),
        info: recordCapture(events, "info"),
        success: recordCapture(events, "success"),
        dim: recordCapture(events, "dim"),
        break: () => recordCapture(events, "break")(),
      }),
    ),
  ).pipe(Layer.provideMerge(LoggerCapture.layer));
}
