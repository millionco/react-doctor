import { ThemeContext } from "./theme-context.js";
import { ThemeLabel } from "./theme-label.js";

const InnerTheme = () => (
  <ThemeContext.Provider value="inner">
    <ThemeLabel />
  </ThemeContext.Provider>
);

export const App = () => (
  <ThemeContext.Provider value="outer">
    <ThemeLabel />
    <InnerTheme />
  </ThemeContext.Provider>
);
