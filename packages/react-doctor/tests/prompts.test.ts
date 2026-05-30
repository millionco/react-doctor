import basePrompts from "prompts";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { prompts } from "../src/cli/utils/prompts.js";
import { stubProcessStdinProperty } from "./helpers/stub-process-stdin-property.js";

vi.mock("prompts", () => ({ default: vi.fn() }));

describe("prompts wrapper", () => {
  let restoreStdinUnref: (() => void) | undefined;

  afterEach(() => {
    restoreStdinUnref?.();
    restoreStdinUnref = undefined;
    vi.clearAllMocks();
  });

  // `prompts` re-refs stdin via `readline.createInterface` and never unrefs it
  // on close, so without this the one-shot CLI hangs after the last prompt.
  it("re-unrefs stdin after a prompt resolves", async () => {
    const unref = vi.fn();
    restoreStdinUnref = stubProcessStdinProperty("unref", unref);
    vi.mocked(basePrompts).mockResolvedValue({ shouldCopy: true });

    await prompts({ type: "confirm", name: "shouldCopy", message: "Copy issues?" });

    expect(unref).toHaveBeenCalledTimes(1);
  });

  it("re-unrefs stdin even when the prompt rejects", async () => {
    const unref = vi.fn();
    restoreStdinUnref = stubProcessStdinProperty("unref", unref);
    vi.mocked(basePrompts).mockRejectedValue(new Error("prompt failed"));

    await expect(
      prompts({ type: "confirm", name: "shouldCopy", message: "Copy issues?" }),
    ).rejects.toThrow("prompt failed");

    expect(unref).toHaveBeenCalledTimes(1);
  });
});
