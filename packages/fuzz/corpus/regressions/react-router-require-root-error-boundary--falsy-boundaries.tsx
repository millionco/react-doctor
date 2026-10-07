// rule: react-router-require-root-error-boundary
// weakness: falsy-route-property
// source: Bugbot review of PR #1411
import { createBrowserRouter } from "react-router";

createBrowserRouter([
  { path: "/", ErrorBoundary: null },
  { path: "/admin", errorElement: undefined },
  { path: "/account", lazy: false },
]);
