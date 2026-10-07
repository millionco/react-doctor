// rule: react-router-internal-route-anchor
// weakness: static-expression-and-falsy-escape-prop
// source: Bugbot review of PR #1411
import { createBrowserRouter } from "react-router";

createBrowserRouter([{ path: "/about", element: <About /> }]);

export const Navigation = () => (
  <a href={"/about"} download={false}>
    About
  </a>
);
