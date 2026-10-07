// rule: react-router-internal-route-anchor
// weakness: falsy-route-property
// source: Bugbot review of PR #1411
import { createBrowserRouter } from "react-router";

createBrowserRouter([
  { path: "/component", Component: null },
  { path: "/element", element: false },
  { path: "/lazy", lazy: undefined },
]);

export const Navigation = () => (
  <>
    <a href="/component">Component</a>
    <a href="/element">Element</a>
    <a href="/lazy">Lazy</a>
  </>
);
