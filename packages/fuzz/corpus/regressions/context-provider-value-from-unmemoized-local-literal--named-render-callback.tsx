// rule: context-provider-value-from-unmemoized-local-literal
// weakness: name-heuristic
// source: deep audit of PR #1000
import { createContext, useMemo } from "react";

const ThemeContext = createContext(null);

export const App = ({ theme, children }) =>
  useMemo(
    function Build() {
      const value = { theme };
      return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
    },
    [theme, children],
  );
