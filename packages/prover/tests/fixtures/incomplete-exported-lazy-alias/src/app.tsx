import { lazy, memo, Suspense } from "react";

const LazyPanel = lazy(() => import("./panel"));

export const PublicPanel = memo(LazyPanel);

export const App = () => (
  <Suspense fallback={<p>loading panel</p>}>
    <LazyPanel />
  </Suspense>
);
