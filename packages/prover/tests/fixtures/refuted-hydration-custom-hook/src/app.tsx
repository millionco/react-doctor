import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";

const useBrowserEnvironment = () => typeof window !== "undefined";

export const App = () => {
  const isBrowser = useBrowserEnvironment();
  return <main>{isBrowser ? "Browser account" : "Server account"}</main>;
};

renderToString(<App />);
hydrateRoot(document, <App />);
