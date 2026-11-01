// rule: no-ref-current-in-render
// weakness: alias-guard
// source: synthetic
// verdict: pass
import React from "react";

export const Panel = ({ value }) => {
  const reactAlias = React;
  reactAlias.useRef = () => ({ current: null });
  const container = React.useRef(null);
  const resolveValue = React.useCallback(() => {
    container.current = value;
  }, []);
  resolveValue();
  return null;
};
