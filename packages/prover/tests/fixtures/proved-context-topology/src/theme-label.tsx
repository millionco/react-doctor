import { use as readReactValue } from "react";
import { ThemeContext } from "./theme-context.js";

export const useTheme = () => readReactValue(ThemeContext);

export const ThemeLabel = () => {
  const theme = useTheme();
  return <output>{theme}</output>;
};
