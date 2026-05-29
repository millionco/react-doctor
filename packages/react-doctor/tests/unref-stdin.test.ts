import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { unrefStdin } from "../src/cli/utils/unref-stdin.js";
import { stubProcessStdinProperty } from "./helpers/stub-process-stdin-property.js";

describe("unrefStdin", () => {
  let restoreStdinUnref: (() => void) | undefined;

  afterEach(() => {
    restoreStdinUnref?.();
    restoreStdinUnref = undefined;
  });

  it("unrefs stdin so an inherited pipe/socket can't hold the event loop open", () => {
    const unref = vi.fn();
    restoreStdinUnref = stubProcessStdinProperty("unref", unref);
    unrefStdin();
    expect(unref).toHaveBeenCalledTimes(1);
  });

  // File / `/dev/null` stdin resolves to an `fs.ReadStream` with no `unref`.
  it("is a no-op when stdin has no unref (file / /dev/null)", () => {
    restoreStdinUnref = stubProcessStdinProperty("unref", undefined);
    expect(() => unrefStdin()).not.toThrow();
  });
});
