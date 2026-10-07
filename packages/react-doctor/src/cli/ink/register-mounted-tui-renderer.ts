import type { render } from "ink";
import { registerActiveTuiRenderer } from "../utils/active-tui-renderer.js";

export const registerMountedTuiRenderer = (instance: ReturnType<typeof render>): (() => void) => {
  let didDisposeRenderer = false;
  const disposeRenderer = (shouldClearOutput: boolean): void => {
    if (didDisposeRenderer) return;
    didDisposeRenderer = true;
    if (shouldClearOutput) instance.clear();
    instance.unmount();
  };
  const unregisterActiveTuiRenderer = registerActiveTuiRenderer({
    preserveOutput: () => disposeRenderer(false),
  });
  return () => {
    unregisterActiveTuiRenderer();
    disposeRenderer(true);
  };
};
