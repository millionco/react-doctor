import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";

export const App = () => (
  <main>{typeof window === "undefined" ? "Server account" : "Browser account"}</main>
);

renderToString(<App />);
hydrateRoot(document, <App />);
