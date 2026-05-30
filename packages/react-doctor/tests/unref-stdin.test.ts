import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { unrefStdin } from "../src/cli/utils/unref-stdin.js";
import { stubProcessStdinProperty } from "./helpers/stub-process-stdin-property.js";

describe("unrefStdin", () => {
  let restoreStdinUnref: (() => void) | undefined;
  let restoreStdinIsTty: (() => void) | undefined;

  afterEach(() => {
    restoreStdinUnref?.();
    restoreStdinUnref = undefined;
    restoreStdinIsTty?.();
    restoreStdinIsTty = undefined;
  });

  it("unrefs stdin so an inherited pipe/socket can't hold the event loop open", () => {
    restoreStdinIsTty = stubProcessStdinProperty("isTTY", false);
    const unref = vi.fn();
    restoreStdinUnref = stubProcessStdinProperty("unref", unref);
    unrefStdin();
    expect(unref).toHaveBeenCalledTimes(1);
  });

  // An interactive TTY is the only case that shows prompts; unref-ing it
  // lets the loop drain while a prompt waits for input (the CLI renders
  // the prompt and then exits by itself), so it must be left ref'd.
  it("does not unref an interactive TTY (regression: prompts must not die by themselves)", () => {
    restoreStdinIsTty = stubProcessStdinProperty("isTTY", true);
    const unref = vi.fn();
    restoreStdinUnref = stubProcessStdinProperty("unref", unref);
    unrefStdin();
    expect(unref).not.toHaveBeenCalled();
  });

  // File / `/dev/null` stdin resolves to an `fs.ReadStream` with no `unref`.
  it("is a no-op when stdin has no unref (file / /dev/null)", () => {
    restoreStdinIsTty = stubProcessStdinProperty("isTTY", false);
    restoreStdinUnref = stubProcessStdinProperty("unref", undefined);
    expect(() => unrefStdin()).not.toThrow();
  });
});
