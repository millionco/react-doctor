// rule: no-prop-callback-in-effect
// weakness: state-provenance
// source: Cursor Bugbot review on PR 1532
// verdict: fail

import { useEffect, useReducer } from "react";

export const Child = ({ onChange }) => {
  const [state] = useReducer(
    (currentState, action) =>
      action.type === "rename" ? { ...currentState, name: action.name } : currentState,
    { name: "" },
  );

  useEffect(() => {
    onChange(state);
  }, [state, onChange]);

  return null;
};
