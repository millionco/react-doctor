import { createContext, useContext } from "react";
import type { ReactNode } from "react";

const ThemeContext = createContext("default");

interface ShellProperties {
  children: ReactNode;
}

const InnerShell = ({ children }: ShellProperties) => <>{children}</>;

const ThemeShell = ({ children }: ShellProperties) => (
  <ThemeContext.Provider value="dark">
    <InnerShell>{children}</InnerShell>
  </ThemeContext.Provider>
);

const ThemeLabel = () => {
  const theme = useContext(ThemeContext);
  return <output>{theme}</output>;
};

export const App = () => (
  <ThemeShell>
    <ThemeLabel />
  </ThemeShell>
);
