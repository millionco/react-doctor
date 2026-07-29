import { lazy, Suspense } from "react";

export const App = () => {
  const LazyPanel = lazy(() => import("./lazy-panel"));
  return (
    <Suspense fallback={<p>loading panel</p>}>
      <LazyPanel />
    </Suspense>
  );
};
