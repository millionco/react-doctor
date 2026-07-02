// rule: rerender-state-only-in-handlers
// weakness: control-flow
// source: Claude Code session (state IS read on the render path — via useMemo
// style and layout-effect deps — so converting to a ref breaks behavior)
import { useLayoutEffect, useMemo, useState } from "react";
import { configureScrollLock } from "./scroll-lock";

export const Sheet = () => {
  const [scrollMoving] = useState(false);
  const [hasBeenOpened] = useState(false);
  const componentStyle = useMemo(
    () => ({ pointerEvents: scrollMoving ? ("none" as const) : ("auto" as const) }),
    [scrollMoving],
  );
  useLayoutEffect(() => {
    configureScrollLock(hasBeenOpened);
  }, [hasBeenOpened]);
  return <div style={componentStyle} />;
};
