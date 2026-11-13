// rule: context-provider-value-from-unmemoized-local-literal
// weakness: alias-guard
// source: synthetic public-source regression
import { createContext, type ReactNode } from "react";

const ThemeContext = createContext<unknown>(null);

const renderNow = (render: () => ReactNode, _unused = 0) => {
  render = () => null;
  return render();
};

export const ContextRoot = () =>
  renderNow(() => {
    const value = {};
    return <ThemeContext.Provider value={value} />;
  });
