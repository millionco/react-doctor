// rule: context-provider-value-from-unmemoized-local-literal
// weakness: shadowing
// source: final subagent audit of PR #1357
import { createContext } from "react";

export const ThemeContext = createContext(null);
const FakeContext = () => null;

export const App = () => {
  try {
    throw FakeContext;
  } catch (ThemeContext) {
    const value = {};
    return <ThemeContext value={value} />;
  }
};
