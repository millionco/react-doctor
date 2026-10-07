// rule: react-router-nested-route-requires-outlet
// weakness: falsy-route-property
// source: Bugbot review of PR #1411
import { createBrowserRouter } from "react-router";

createBrowserRouter([
  { Component: () => <main />, children: null },
  { Component: () => <main />, children: undefined },
  { Component: () => <main />, children: false },
]);
