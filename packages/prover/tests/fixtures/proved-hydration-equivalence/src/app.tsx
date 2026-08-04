import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";

export const App = () => <main aria-label="account">Account</main>;

renderToString(<App />, { identifierPrefix: "account-" });
hydrateRoot(document, <App />, { identifierPrefix: "account-" });
