import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";

export const App = () => <main>Account</main>;

export const renderAccountPage = () => renderToString(<App />);

export const hydrateAccountPage = () => hydrateRoot(document, <App />);
