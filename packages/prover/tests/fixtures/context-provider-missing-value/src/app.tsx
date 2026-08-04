import { createContext, useContext } from "react";

const ThemeContext = createContext("default");

const ThemeLabel = () => {
  const theme = useContext(ThemeContext);
  return <output>{theme}</output>;
};

export const App = () => (
  <ThemeContext.Provider>
    <ThemeLabel />
  </ThemeContext.Provider>
);
