// rule: react-router-no-duplicate-route-id
// weakness: wrapper-transparency
// source: Bugbot review of PR #1411
import { createBrowserRouter } from "react-router";

createBrowserRouter([
  { id: "dashboard" as const, path: "/" },
  { id: "dashboard" satisfies string, path: "/settings" },
]);
