import { lazy, Suspense } from "react";
import type { ReactNode } from "react";

const LazyPanel = lazy(() => import("./lazy-panel"));

interface SuspenseShellProperties {
  children: ReactNode;
}

const SuspenseShell = ({ children }: SuspenseShellProperties) => (
  <Suspense fallback={<p>loading slot</p>}>{children}</Suspense>
);

export const App = () => (
  <SuspenseShell>
    <LazyPanel />
  </SuspenseShell>
);
