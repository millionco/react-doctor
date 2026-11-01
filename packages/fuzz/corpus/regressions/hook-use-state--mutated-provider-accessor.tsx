// rule: hook-use-state
// weakness: alias-guard
// source: independently authored React provider mutation control
// verdict: fail
import React from "react";

const replacementState = () => [7];
React.__defineGetter__("useState", () => replacementState);

export const MutationPanel = () => {
  const [stored] = React.useState(7);
  return <span>{stored}</span>;
};
