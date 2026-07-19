// rule: context-provider-value-from-unmemoized-local-literal
// weakness: mutation
import { createContext } from "react";

const Context = createContext(null);
const stableValue = {};

export const App = () => {
  let value = {};
  value = stableValue;
  return <Context.Provider value={value} />;
};
