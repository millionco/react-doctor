import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";

export const App = () => <main>Account</main>;

const clientOptions = { identifierPrefix: "account-" };

renderToString(<App />, { identifierPrefix: "account-" });
hydrateRoot(document, <App />, clientOptions);
