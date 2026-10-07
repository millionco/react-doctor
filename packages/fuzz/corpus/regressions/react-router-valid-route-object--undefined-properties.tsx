// rule: react-router-valid-route-object
// weakness: truthiness-semantics
// source: adversarial contract audit of PR #1411
import { createBrowserRouter } from "react-router";

createBrowserRouter([
  {
    index: true,
    path: undefined,
    children: undefined,
    Component: undefined,
    element: <Home />,
  },
]);
