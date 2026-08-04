import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";

export const App = () => <main>{navigator.language}</main>;

renderToString(<App />);
hydrateRoot(document, <App />);
