import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import type { ReactNode } from "react";

interface ShellProperties {
  children: ReactNode;
}

const AccountLocale = () => <strong>{navigator.language}</strong>;

const Shell = ({ children }: ShellProperties) => <main>{children}</main>;

export const App = () => (
  <Shell>
    <AccountLocale />
  </Shell>
);

renderToString(<App />);
hydrateRoot(document, <App />);
