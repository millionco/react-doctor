import { lazy, Suspense } from "react";
import type { ComponentType } from "react";

declare const withRetry: (component: ComponentType) => ComponentType;

const LazyPanel = lazy(() => import("./panel"));
const RetriedPanel = withRetry(LazyPanel);

export const App = () => (
  <Suspense fallback={<p>loading panel</p>}>
    <RetriedPanel />
  </Suspense>
);
