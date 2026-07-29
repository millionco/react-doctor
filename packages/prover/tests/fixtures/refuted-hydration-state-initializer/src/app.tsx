import { useState } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";

export const App = () => {
  const [theme] = useState(() =>
    window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
  );
  return <main>{theme}</main>;
};

renderToString(<App />);
hydrateRoot(document, <App />);
