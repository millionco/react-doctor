import { lazy, Suspense } from "react";

const LazyPanel = lazy(() =>
  import("./lazy-panel").then((module) => ({ default: module.LazyPanel })),
);

const PanelRoute = () => <LazyPanel />;

export const App = () => (
  <Suspense fallback={<p>loading route</p>}>
    <PanelRoute />
  </Suspense>
);
