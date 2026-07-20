// rule: react-router-nested-route-requires-outlet
// weakness: nested-delegated-component
// source: Bugbot PR #1411

import { createBrowserRouter } from "react-router";

const Layout = () => null;
const Child = () => null;
const OtherChild = () => null;

export const router = createBrowserRouter([
  {
    element: (
      <main>
        <Layout />
      </main>
    ),
    children: [{ path: "child", element: <Child /> }],
  },
  {
    element: (
      <>
        <header />
        <Layout />
      </>
    ),
    children: [{ path: "other", element: <OtherChild /> }],
  },
]);
