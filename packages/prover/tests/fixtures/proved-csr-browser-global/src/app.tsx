import { createRoot } from "react-dom/client";

export const App = () => <main>{window.innerWidth}</main>;

createRoot(document.body).render(<App />);
