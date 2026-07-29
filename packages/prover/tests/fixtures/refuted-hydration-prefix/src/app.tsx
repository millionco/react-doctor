import { useId } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";

export const App = () => {
  const fieldId = useId();
  return <label htmlFor={fieldId}>Account</label>;
};

renderToString(<App />, { identifierPrefix: "server-" });
hydrateRoot(document, <App />, { identifierPrefix: "client-" });
