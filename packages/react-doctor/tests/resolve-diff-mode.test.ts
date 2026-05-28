import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { DiffInfo } from "@react-doctor/core";
import { resolveDiffMode } from "../src/cli/utils/resolve-diff-mode.js";
import { prompts } from "../src/cli/utils/prompts.js";

vi.mock("../src/cli/utils/prompts.js", () => ({
  prompts: vi.fn(),
}));

interface ConsoleWarnHandle {
  capturedMessages: string[];
  restore: () => void;
}

const captureConsoleWarn = (): ConsoleWarnHandle => {
  const capturedMessages: string[] = [];
  const spy = vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
    capturedMessages.push(args.map(String).join(" "));
  });
  return {
    capturedMessages,
    restore: () => spy.mockRestore(),
  };
};

const buildDiffInfo = (overrides: Partial<DiffInfo> = {}): DiffInfo => ({
  currentBranch: "feature",
  baseBranch: "main",
  changedFiles: ["src/App.tsx"],
  ...overrides,
});

describe("resolveDiffMode (issue #298 messaging)", () => {
  let consoleHandle: ConsoleWarnHandle;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleHandle = captureConsoleWarn();
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.mocked(prompts).mockResolvedValue({ scanScope: "full" });
  });

  afterEach(() => {
    consoleHandle.restore();
    consoleLogSpy.mockRestore();
  });

  it("warns with a base-aware message when --diff <base> was passed but the diff could not be computed", async () => {
    const isDiffMode = await resolveDiffMode(null, "origin/master", true, false);
    expect(isDiffMode).toBe(false);
    expect(consoleHandle.capturedMessages.join("\n")).toMatch(/origin\/master/);
    expect(consoleHandle.capturedMessages.join("\n")).toMatch(
      /merge-base failed|HEAD has no history/,
    );
  });

  it("keeps the original generic message when --diff (no base) was passed but the diff could not be computed", async () => {
    const isDiffMode = await resolveDiffMode(null, true, true, false);
    expect(isDiffMode).toBe(false);
    expect(consoleHandle.capturedMessages.join("\n")).toMatch(/No feature branch or uncommitted/);
  });

  it("returns true (enables diff mode) when an explicit --diff base resolved on detached HEAD", async () => {
    const detachedDiffInfo = buildDiffInfo({ currentBranch: null });
    const isDiffMode = await resolveDiffMode(detachedDiffInfo, "origin/master", true, false);
    expect(isDiffMode).toBe(true);
    expect(consoleHandle.capturedMessages).toHaveLength(0);
  });

  it("stays silent in quiet mode regardless of failure shape", async () => {
    await resolveDiffMode(null, "origin/master", true, true);
    expect(consoleHandle.capturedMessages).toHaveLength(0);
  });

  it("uses a specific label for the scope selection prompt", async () => {
    const isDiffMode = await resolveDiffMode(buildDiffInfo(), undefined, false, false);

    expect(isDiffMode).toBe(false);
    expect(prompts).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "scanScope",
        message: "Choose what to scan",
      }),
    );
  });
});
