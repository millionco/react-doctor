// rule: context-provider-value-from-unmemoized-local-literal
// weakness: callback-provenance
// source: Bugbot review of PR #1357
import { createContext } from "react";

const ThemeContext = createContext(null);
const renderNow = (render) => render();

export const App = () => {
  const Inner = () => {
    const value = {};
    return <ThemeContext.Provider value={value} />;
  };
  return renderNow(Inner);
};
