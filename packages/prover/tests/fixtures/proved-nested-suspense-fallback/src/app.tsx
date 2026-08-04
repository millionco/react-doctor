import { lazy, Suspense } from "react";

const LazyPanel = lazy(() => import("./panel"));

export const App = () => (
  <Suspense fallback={<p>loading application</p>}>
    <Suspense fallback={<LazyPanel />}>
      <p>content</p>
    </Suspense>
  </Suspense>
);
