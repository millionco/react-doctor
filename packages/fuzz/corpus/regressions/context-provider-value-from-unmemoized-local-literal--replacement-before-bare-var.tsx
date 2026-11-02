// rule: context-provider-value-from-unmemoized-local-literal
// verdict: pass
// weakness: copy-tracking
// source: independently authored public synthetic callback replacement
import { createContext } from "react";

const ThemeContext = createContext(null);

const renderNow = (render) => {
  var render = () => null;
  var render;
  return render();
};

export const App = () =>
  renderNow(() => {
    const value = {};
    return <ThemeContext.Provider value={value} />;
  });
