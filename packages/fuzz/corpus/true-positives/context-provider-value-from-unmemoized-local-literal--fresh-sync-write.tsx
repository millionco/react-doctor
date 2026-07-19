// rule: context-provider-value-from-unmemoized-local-literal
// weakness: write-order
// source: Cursor Bugbot review of PR #1357
import { createContext } from "react";

const ThemeContext = createContext(null);
const STABLE_VALUE = { theme: "dark" };

export const App = () => {
  let value = STABLE_VALUE;
  value = { theme: "light" };
  return <ThemeContext.Provider value={value} />;
};
