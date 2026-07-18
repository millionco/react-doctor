// rule: context-provider-value-from-unmemoized-local-literal
// weakness: control-flow
// source: exact-head adversarial audit of PR #1357
import { createContext } from "react";

const ThemeContext = createContext(null);
const inspect = (render: () => React.ReactNode) => {
  render();
  return null;
};

export const App = () =>
  inspect(() => {
    const value = {};
    return <ThemeContext.Provider value={value} />;
  });
