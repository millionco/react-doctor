import { lazy, Suspense } from "react";

const LazyPanel = lazy(() => import("./panel"));

export const App = () => (
  <Suspense fallback={<p>loading panels</p>}>
    {[1].map((panelId) => (
      <LazyPanel key={panelId} />
    ))}
  </Suspense>
);
