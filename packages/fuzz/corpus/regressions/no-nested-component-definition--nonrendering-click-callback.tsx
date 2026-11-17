// rule: no-nested-component-definition
// verdict: pass
// weakness: name-heuristic
// source: independently authored event-role regression

import { useState } from "react";

export const ActionPanel = () => {
  const [pressed, setPressed] = useState(false);
  const Press = () => {
    setPressed(true);
  };
  return (
    <button type="button" onClick={Press}>
      {pressed ? "Pressed" : "Press"}
    </button>
  );
};
