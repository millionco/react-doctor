// rule: context-provider-value-from-unmemoized-local-literal
// weakness: callback-provenance
// source: final subagent audit of PR #1357
import { createContext, useMemo } from "react";

const ThemeContext = createContext(null);

export const App = ({ theme }) => {
  const Build = () => {
    const value = { theme };
    return <ThemeContext.Provider value={value} />;
  };
  return useMemo(Build, [theme]);
};
