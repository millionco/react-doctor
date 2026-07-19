// rule: context-provider-value-from-unmemoized-local-literal
// weakness: mutation
// source: deep audit of PR #1000
import { createContext } from "react";

var ThemeContext = createContext(null);
var ThemeContext = FakeContext;

export const App = () => {
  const value = {};
  return <ThemeContext value={value} />;
};
