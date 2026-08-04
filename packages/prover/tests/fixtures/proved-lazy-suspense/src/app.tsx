import { lazy, Suspense } from "react";

const LazyPanel = lazy(() => import("./lazy-panel"));

export const App = () => (
  <Suspense fallback={<p>loading panel</p>}>
    <LazyPanel />
  </Suspense>
);
