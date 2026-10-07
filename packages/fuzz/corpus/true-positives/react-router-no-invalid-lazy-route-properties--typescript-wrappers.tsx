// rule: react-router-no-invalid-lazy-route-properties

import { createBrowserRouter } from "react-router";

createBrowserRouter([
  { path: "/", lazy: async () => ({ path: "/changed" }) as const },
  {
    path: "/other",
    lazy: async () => ({ id: "changed" }) satisfies { id: string },
  },
]);
