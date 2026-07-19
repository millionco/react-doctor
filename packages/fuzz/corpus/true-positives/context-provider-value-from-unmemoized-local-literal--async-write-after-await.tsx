// rule: context-provider-value-from-unmemoized-local-literal
// weakness: write-order
// source: final subagent audit of PR #1357
import { createContext } from "react";

const ThemeContext = createContext(null);
const stableValue = {};

export const App = () => {
  let value = {};
  const update = async () => {
    await Promise.resolve();
    value = stableValue;
  };
  void update();
  return <ThemeContext.Provider value={value} />;
};
