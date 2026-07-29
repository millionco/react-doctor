import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";

const ACCOUNT_CREATED_AT = "2024-04-05T19:34:38.000Z";

export const App = () => <main>{new Date(ACCOUNT_CREATED_AT).toLocaleString()}</main>;

renderToString(<App />);
hydrateRoot(document, <App />);
