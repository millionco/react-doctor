// rule: no-ref-current-in-render
// weakness: control-flow
// source: synthetic
// verdict: pass
import React from "react";

export const Panel = ({ value }) => {
  const container = React.useRef(null);
  const resolveValue = React.useCallback(() => {
    container.current = value;
  }, []);
  return null;
  (() => resolveValue())();
};
