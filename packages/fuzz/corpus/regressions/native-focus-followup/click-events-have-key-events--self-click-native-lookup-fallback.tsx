// rule: click-events-have-key-events, no-static-element-interactions
// weakness: control-flow
// source: invented synthetic regression
// verdict: pass

import { useCallback } from "react";

export const SearchField = () => {
  const forwardNativeFocus = useCallback((pointerEvent: React.MouseEvent<HTMLDivElement>) => {
    if (pointerEvent.target === pointerEvent.currentTarget) {
      const destination =
        document.getElementById("fern-search") ?? document.querySelector("#willow-search");
      destination?.focus();
    }
  }, []);
  return <div onClick={forwardNativeFocus} />;
};
