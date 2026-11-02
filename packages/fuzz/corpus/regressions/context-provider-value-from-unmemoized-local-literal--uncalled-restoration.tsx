// rule: context-provider-value-from-unmemoized-local-literal
// verdict: pass
// weakness: copy-tracking
// source: independently authored public synthetic callback replacement
import { createContext } from "react";

const ThemeContext = createContext(null);

const renderNow = (render) => {
  const original = render;
  var render = () => null;
  function restore() {
    render = original;
  }
  return render();
};

export const App = () =>
  renderNow(() => {
    const value = {};
    return <ThemeContext.Provider value={value} />;
  });
