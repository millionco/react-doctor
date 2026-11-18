// rule: rerender-lazy-state-init
// weakness: stable-context-call-forms
// source: synthetic audit regression
import React, { createContext, useContext as readContext, useState } from "react";

const Primary = createContext("theme");

export const OptionalContext = () => {
  const [value] = useState(readContext?.(Primary));
  return <span>{value}</span>;
};

export const ComputedContext = () => {
  const [value] = useState(React["useContext"](Primary));
  return <span>{value}</span>;
};
