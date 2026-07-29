import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { performance } from "node:perf_hooks";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { InspectResult } from "../src/core/core-types.js";
import { recordRunEvent } from "../src/cli/utils/build-run-event.js";
import { inspect } from "../src/inspect.js";
import { commitAll, initGitRepo, setupReactProject } from "./regressions/_helpers.js";

interface MockSpinner {
  text: string;
  readonly start: () => MockSpinner;
  readonly stop: () => void;
  readonly succeed: () => void;
  readonly fail: () => void;
}

interface CapturedConsoleEvent {
  readonly method: "debug" | "error" | "info" | "log" | "warn";
  readonly argumentsList: ReadonlyArray<string>;
}

interface CapturedInspectRun {
  readonly result: InspectResult;
  readonly events: ReadonlyArray<CapturedConsoleEvent>;
}

const FIXED_PERFORMANCE_TIME_MS = 1_000;
const temporaryDirectories: string[] = [];

vi.mock("../src/cli/utils/build-run-event.js", () => ({
  recordRunEvent: vi.fn(),
}));

vi.mock("ora", () => ({
  default: (): MockSpinner => {
    let spinner: MockSpinner;
    spinner = {
      text: "",
      start: () => spinner,
      stop: () => {},
      succeed: () => {},
      fail: () => {},
    };
    return spinner;
  },
}));

const captureInspectRun = async (projectDirectory: string): Promise<CapturedInspectRun> => {
  const events: CapturedConsoleEvent[] = [];
  const recordEvent =
    (method: CapturedConsoleEvent["method"]) =>
    (...argumentsList: unknown[]): void => {
      events.push({
        method,
        argumentsList: argumentsList.map(String),
      });
    };
  const debugSpy = vi.spyOn(console, "debug").mockImplementation(recordEvent("debug"));
  const errorSpy = vi.spyOn(console, "error").mockImplementation(recordEvent("error"));
  const infoSpy = vi.spyOn(console, "info").mockImplementation(recordEvent("info"));
  const logSpy = vi.spyOn(console, "log").mockImplementation(recordEvent("log"));
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(recordEvent("warn"));

  try {
    const result = await inspect(projectDirectory, {
      lint: false,
      deadCode: false,
      supplyChain: false,
      noScore: true,
    });
    return { result, events };
  } finally {
    debugSpy.mockRestore();
    errorSpy.mockRestore();
    infoSpy.mockRestore();
    logSpy.mockRestore();
    warnSpy.mockRestore();
  }
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const temporaryDirectory of temporaryDirectories.splice(0)) {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

describe("inspect whole-repository cache output parity", () => {
  it("returns and renders byte-identical cold and replayed results", async () => {
    const temporaryDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "react-doctor-cache-output-parity-"),
    );
    temporaryDirectories.push(temporaryDirectory);
    const projectDirectory = setupReactProject(temporaryDirectory, "app");
    initGitRepo(projectDirectory);
    commitAll(projectDirectory, "initial project");
    vi.stubEnv("REACT_DOCTOR_CACHE_DIR", path.join(temporaryDirectory, "react-doctor-cache"));
    vi.spyOn(performance, "now").mockReturnValue(FIXED_PERFORMANCE_TIME_MS);
    const mockedRecordRunEvent = vi.mocked(recordRunEvent);

    const coldRun = await captureInspectRun(projectDirectory);
    expect(mockedRecordRunEvent.mock.calls.at(-1)?.[1].wholeRepoCacheHit).toBe(false);
    const replayedRun = await captureInspectRun(projectDirectory);

    expect(mockedRecordRunEvent.mock.calls.at(-1)?.[1].wholeRepoCacheHit).toBe(true);
    expect(replayedRun.result).toEqual(coldRun.result);
    expect(replayedRun.events).toEqual(coldRun.events);
    expect(coldRun.events.length).toBeGreaterThan(0);
  });
});
