import { lazy, Suspense } from "react";

declare const loadPanel: () => Promise<{ default: () => unknown }>;

const LazyPanel = lazy(loadPanel);

export const App = () => (
  <Suspense fallback={<p>loading panel</p>}>
    <LazyPanel />
  </Suspense>
);
