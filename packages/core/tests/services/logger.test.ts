import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";
import { describe, expect, it } from "vite-plus/test";
import { Logger, LoggerCapture } from "../../src/services/logger.js";

describe("Logger.layerSilent", () => {
  it("every method is a void no-op", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const logger = yield* Logger;
        logger.log("nothing");
        logger.error("nothing");
        logger.warn("nothing");
        logger.info("nothing");
        logger.success("nothing");
        logger.dim("nothing");
        logger.break();
        return "ok";
      }).pipe(Effect.provide(Logger.layerSilent)),
    );
    expect(result).toBe("ok");
  });
});

describe("Logger.layerCapture", () => {
  it("records every method call into LoggerCapture Ref with the right level + joined args", async () => {
    const events = await Effect.runPromise(
      Effect.gen(function* () {
        const logger = yield* Logger;
        logger.log("hello", "world");
        logger.error("boom");
        logger.warn("careful");
        logger.info("fyi");
        logger.success("done");
        logger.dim("muted");
        logger.break();
        const ref = yield* LoggerCapture;
        return yield* Ref.get(ref);
      }).pipe(Effect.provide(Logger.layerCapture)),
    );
    expect(events).toEqual([
      { level: "log", message: "hello world" },
      { level: "error", message: "boom" },
      { level: "warn", message: "careful" },
      { level: "info", message: "fyi" },
      { level: "success", message: "done" },
      { level: "dim", message: "muted" },
      { level: "break", message: "" },
    ]);
  });

  it("LoggerCapture starts empty", async () => {
    const events = await Effect.runPromise(
      Effect.gen(function* () {
        const ref = yield* LoggerCapture;
        return yield* Ref.get(ref);
      }).pipe(Effect.provide(Logger.layerCapture)),
    );
    expect(events).toEqual([]);
  });
});

describe("Logger.layerConsole", () => {
  it("provides the consoleLogger instance (writes to console; verified by spy in cli tests)", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const logger = yield* Logger;
        return typeof logger.log === "function";
      }).pipe(Effect.provide(Logger.layerConsole)),
    );
    expect(result).toBe(true);
  });
});
