import { createContext, useContext } from "react";

const ThemeContext = createContext("system");

export const ThemeLabel = () => {
  const theme = useContext(ThemeContext);
  return <p>{theme}</p>;
};
