import React, { createContext, useContext } from "react";

export const createLegacyInput = React.createFactory("input");

const ThemeContext = createContext<"light" | "dark">("light");

export const ThemedLabel = ({ text }: { text: string }) => {
  const theme = useContext(ThemeContext);
  return <span data-theme={theme}>{text}</span>;
};
