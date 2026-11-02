// rule: context-provider-value-from-unmemoized-local-literal
// weakness: copy-tracking
// source: synthetic public-source regression
// verdict: pass
import { createContext } from "react";

const ThemeContext = createContext<unknown>(null);

const renderNow = (render) => {
  var render = () => null;
  return render();
};

export const ContextRoot = () =>
  renderNow(() => {
    const value = {};
    return <ThemeContext.Provider value={value} />;
  });
