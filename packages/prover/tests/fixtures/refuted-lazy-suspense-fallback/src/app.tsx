import { lazy, Suspense } from "react";

const LazyPanel = lazy(() => import("./panel"));

export const App = () => (
  <Suspense fallback={<LazyPanel />}>
    <p>content</p>
  </Suspense>
);
