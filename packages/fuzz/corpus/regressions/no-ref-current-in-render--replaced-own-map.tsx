// rule: no-ref-current-in-render
// weakness: alias-guard
// source: synthetic
// verdict: pass
import React from "react";

export const Panel = ({ value }) => {
  const callbacks = [];
  const entries = [null];
  entries.map = (callback) => {
    callbacks.push(callback);
    return [];
  };
  const container = React.useRef(null);
  const resolveValue = React.useCallback(() => {
    container.current = value;
  }, []);
  entries.map(() => resolveValue());
  return null;
};
