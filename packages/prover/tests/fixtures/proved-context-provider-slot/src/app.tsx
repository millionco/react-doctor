import { createContext, useContext } from "react";
import type { ReactNode } from "react";

const ThemeContext = createContext("default");

interface ThemeProviderShellProperties {
  children: ReactNode;
}

const ThemeProviderShell = ({ children }: ThemeProviderShellProperties) => (
  <ThemeContext value="dark">{children}</ThemeContext>
);

const ThemeLabel = () => {
  const theme = useContext(ThemeContext);
  return <output>{theme}</output>;
};

export const App = () => (
  <ThemeProviderShell>
    <ThemeLabel />
  </ThemeProviderShell>
);
