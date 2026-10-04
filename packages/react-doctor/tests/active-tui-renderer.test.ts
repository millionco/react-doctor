import { describe, expect, it, vi } from "vite-plus/test";
import {
  preserveActiveTuiRendererOutput,
  registerActiveTuiRenderer,
} from "../src/cli/utils/active-tui-renderer.js";

describe("activeTuiRenderer", () => {
  it("preserves only the currently registered renderer", () => {
    const firstPreserveOutput = vi.fn();
    const secondPreserveOutput = vi.fn();
    const unregisterFirst = registerActiveTuiRenderer({
      preserveOutput: firstPreserveOutput,
    });
    registerActiveTuiRenderer({ preserveOutput: secondPreserveOutput });

    unregisterFirst();
    preserveActiveTuiRendererOutput();
    preserveActiveTuiRendererOutput();

    expect(firstPreserveOutput).not.toHaveBeenCalled();
    expect(secondPreserveOutput).toHaveBeenCalledTimes(1);
  });
});
