import { lazy, Suspense } from "react";
import type { ComponentType } from "react";

declare const withRetry: (component: ComponentType) => ComponentType;

const LazyPanel = withRetry(lazy(() => import("./panel")));

export const App = () => (
  <Suspense fallback={<p>loading panel</p>}>
    <LazyPanel />
  </Suspense>
);
