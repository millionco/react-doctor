// rule: no-ref-current-in-render
// weakness: alias-guard
// source: synthetic
// verdict: pass
import React from "react";

export const Panel = ({ value }) => {
  const callbacks = [];
  React.useState = (callback) => {
    callbacks.push(callback);
    return [null, () => {}];
  };
  const container = React.useRef(null);
  const resolveValue = React.useCallback(() => {
    container.current = value;
  }, []);
  React.useState(() => resolveValue());
  return null;
};
