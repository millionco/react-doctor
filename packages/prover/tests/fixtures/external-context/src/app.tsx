import { useContext } from "react";
import { ThemeContext } from "theme-library";

export const App = () => {
  const theme = useContext(ThemeContext);
  return <output>{theme}</output>;
};
