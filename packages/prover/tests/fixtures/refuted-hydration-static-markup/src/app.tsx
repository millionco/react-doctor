import { hydrateRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";

export const App = () => <main>Account</main>;

renderToStaticMarkup(<App />);
hydrateRoot(document, <App />);
