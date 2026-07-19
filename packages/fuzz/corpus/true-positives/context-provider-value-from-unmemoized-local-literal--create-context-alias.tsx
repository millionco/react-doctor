// rule: context-provider-value-from-unmemoized-local-literal
// weakness: provenance
import { createContext } from "react";

const makeContext = createContext;
const ThemeContext = makeContext(null);

export const App = () => {
  const value = {};
  return <ThemeContext value={value} />;
};
