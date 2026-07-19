// rule: context-provider-value-from-unmemoized-local-literal
// weakness: provenance
// source: deep audit of PR #1000
import { ThemeContext } from "./theme-context";

export const App = () => {
  const value = {};
  return <ThemeContext value={value} />;
};
