import { lazy } from "react";
import type { ComponentType, ReactNode } from "react";

declare const ExternalShell: ComponentType<{ children: ReactNode }>;

const LazyPanel = lazy(() => import("./lazy-panel"));

export const App = () => (
  <ExternalShell>
    <LazyPanel />
  </ExternalShell>
);
