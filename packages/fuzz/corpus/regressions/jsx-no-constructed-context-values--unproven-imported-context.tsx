// rule: jsx-no-constructed-context-values
// weakness: cross-file
// source: adversarial review of PR #1402 parity removals

import { ThemeContext } from "./theme-context";

export const ThemeCard = () => <ThemeContext value={{ mode: "dark" }} />;

export const loadDataCard = async () => {
  const { DataContext } = await import("@runtime");
  return () => <DataContext.Provider value={{ data: "ready" }} />;
};
