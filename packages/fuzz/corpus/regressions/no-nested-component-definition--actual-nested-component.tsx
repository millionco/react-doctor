// rule: no-nested-component-definition
// verdict: fail
// weakness: name-heuristic
// source: independently authored component-role control

import { useState } from "react";

export const ActionPanel = () => {
  const Counter = () => {
    const [value] = useState(0);
    return <span>{value}</span>;
  };
  return <Counter />;
};
