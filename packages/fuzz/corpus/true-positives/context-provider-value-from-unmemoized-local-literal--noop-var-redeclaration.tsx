// rule: context-provider-value-from-unmemoized-local-literal
// weakness: write-order
// source: final subagent audit of PR #1357
import { createContext } from "react";

const ThemeContext = createContext(null);

export const App = () => {
  var value = {};
  var value;
  return <ThemeContext.Provider value={value} />;
};
