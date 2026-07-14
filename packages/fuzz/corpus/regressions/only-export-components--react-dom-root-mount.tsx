// rule: only-export-components
// weakness: provenance
// source: job-grounded Fast Refresh capability audit 2026-07-13
import { createRoot as mountRoot } from "react-dom/client";

export const App = () => <div />;
export const runtimeConfig = getConfig();

const applicationRoot = mountRoot(document.getElementById("root")!);
applicationRoot.render(<App />);
