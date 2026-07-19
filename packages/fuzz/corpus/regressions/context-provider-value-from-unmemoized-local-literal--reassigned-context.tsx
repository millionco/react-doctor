// rule: context-provider-value-from-unmemoized-local-literal
// weakness: mutation
import { createContext } from "react";

let ThemeContext = createContext(null);
ThemeContext = FakeContext;

export const App = () => {
  const value = {};
  return <ThemeContext value={value} />;
};
