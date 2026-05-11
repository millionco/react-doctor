import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { isLoggerSilent, logger, setLoggerSilent } from "../src/utils/logger.js";

describe("logger", () => {
  afterEach(() => {
    setLoggerSilent(false);
    vi.restoreAllMocks();
  });

  it("writes all output methods when enabled", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    logger.error("error", "message");
    logger.warn("warn", "message");
    logger.info("info", "message");
    logger.success("success", "message");
    logger.dim("dim", "message");
    logger.log("plain", "message");
    logger.break();

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledTimes(5);
  });

  it("suppresses output when silent", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    setLoggerSilent(true);

    logger.error("error");
    logger.warn("warn");
    logger.info("info");
    logger.success("success");
    logger.dim("dim");
    logger.log("plain");
    logger.break();

    expect(isLoggerSilent()).toBe(true);
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
  });
});
