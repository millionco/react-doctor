// rule: context-provider-value-from-unmemoized-local-literal
// weakness: reachability
// source: exact-head adversarial audit of PR #1357
import { createContext } from "react";

const ThemeContext = createContext(null);
const STABLE_VALUE = { theme: "dark" };
let moduleValue = STABLE_VALUE;
moduleValue = { theme: "light" };

export const ModuleValueApp = () => <ThemeContext.Provider value={moduleValue} />;

export const UnreachableWriteApp = () => {
  let value = STABLE_VALUE;
  const update = () => {
    return;
    value = { theme: "light" };
  };
  update();
  return <ThemeContext.Provider value={value} />;
};

export const DeadBranchApp = () => (
  <>
    {false &&
      (() => {
        const value = {};
        return <ThemeContext.Provider value={value} />;
      })()}
  </>
);
