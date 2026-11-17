// rule: context-provider-value-from-unmemoized-local-literal
// weakness: control-flow
// source: synthetic public-source regression
// verdict: fail
import { createContext, type ReactNode } from "react";

const ThemeContext = createContext<unknown>(null);

const renderNow = (render: () => ReactNode) => {
  const replace = async () => {
    await Promise.resolve();
    render = () => null;
  };
  replace();
  return render();
};

export const ContextRoot = () =>
  renderNow(() => {
    const value = {};
    return <ThemeContext.Provider value={value} />;
  });
