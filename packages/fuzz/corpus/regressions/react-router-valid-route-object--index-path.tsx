// rule: react-router-valid-route-object
// weakness: upstream-contract
// source: React Router main IndexRouteObject and runtime invariant audit for PR #1411
import { createBrowserRouter } from "react-router";

createBrowserRouter([{ index: true, path: "home", element: <Home /> }]);
