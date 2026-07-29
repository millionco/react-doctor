import { lazy, Suspense } from "react";

const LazyPanel = lazy(() => Promise.resolve({ default: 42 }));

export const App = () => (
  <Suspense fallback={<p>loading panel</p>}>
    <LazyPanel />
  </Suspense>
);
