// rule: context-provider-value-from-unmemoized-local-literal
// verdict: pass
// weakness: control-flow
// source: public PR #2337 review, unused pure helper parameter
import { createContext } from "react";

const ThemeContext = createContext(null);

const helper = (callback: () => unknown, unused = () => null) => {
  const replace = async () => {
    try {
      await (() => {
        throw 0;
      })();
    } catch {
      callback = () => null;
    }
  };
  replace();
  return callback();
};

export const App = () =>
  helper(() => {
    const value = {};
    return <ThemeContext.Provider value={value} />;
  });
