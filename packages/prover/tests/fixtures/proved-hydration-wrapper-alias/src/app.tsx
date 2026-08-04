import { StrictMode } from "react";
import * as ReactClient from "react-dom/client";
import * as ReactServer from "react-dom/server";

export const App = () => <main>Account</main>;

const serverTree = (
  <StrictMode>
    <App />
  </StrictMode>
);
const clientTree = (
  <StrictMode>
    <App />
  </StrictMode>
);

ReactServer.renderToString(serverTree);
ReactClient.hydrateRoot(document, clientTree);
