import { describe, expect, it, vi } from "vite-plus/test";
import {
  clearActiveTuiRenderer,
  registerActiveTuiRenderer,
} from "../src/cli/utils/active-tui-renderer.js";

describe("activeTuiRenderer", () => {
  it("clears only the currently registered renderer", () => {
    const firstClear = vi.fn();
    const secondClear = vi.fn();
    const unregisterFirst = registerActiveTuiRenderer({ clear: firstClear });
    registerActiveTuiRenderer({ clear: secondClear });

    unregisterFirst();
    clearActiveTuiRenderer();
    clearActiveTuiRenderer();

    expect(firstClear).not.toHaveBeenCalled();
    expect(secondClear).toHaveBeenCalledTimes(1);
  });
});
