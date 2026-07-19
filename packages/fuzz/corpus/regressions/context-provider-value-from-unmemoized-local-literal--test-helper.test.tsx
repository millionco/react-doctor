// rule: context-provider-value-from-unmemoized-local-literal
// weakness: test-noise
// source: Cursor Bugbot review of PR #1357
import { createContext } from "react";

const ThemeContext = createContext(null);

export const TestProvider = () => {
  const value = {};
  return <ThemeContext.Provider value={value} />;
};
