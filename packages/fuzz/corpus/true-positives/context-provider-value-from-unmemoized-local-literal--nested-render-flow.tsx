// rule: context-provider-value-from-unmemoized-local-literal
// weakness: render-flow
// source: exact-head adversarial audit of PR #1357
import React, { createContext } from "react";

const ThemeContext = createContext(null);
const STABLE_VALUE = { theme: "dark" };

export const App = () => {
  let value = STABLE_VALUE;
  updateOuter();
  return React.createElement(React.Fragment, null, <ThemeContext.Provider value={value} />);

  function updateOuter() {
    updateValue();
  }

  function updateValue() {
    value = { theme: "light" };
  }
};
