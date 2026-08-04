import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";

export const App = () => <main>Account</main>;
export const AlternateApp = () => <main>Alternate account</main>;

const selectedApp = Math.random() > 0.5 ? <App /> : <AlternateApp />;

renderToString(<App />);
hydrateRoot(document, selectedApp);
