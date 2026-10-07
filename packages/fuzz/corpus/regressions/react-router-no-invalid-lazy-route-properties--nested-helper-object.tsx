// rule: react-router-no-invalid-lazy-route-properties
// weakness: name-heuristic
// source: Bugbot PR #1411

import { createBrowserRouter } from "react-router";

export const router = createBrowserRouter([
  {
    path: "/",
    Component: () => {
      const helper = {
        lazy: async () => ({ path: "/changed" }),
      };

      return (
        <button type="button" onClick={() => void helper.lazy()}>
          Load helper
        </button>
      );
    },
  },
]);
