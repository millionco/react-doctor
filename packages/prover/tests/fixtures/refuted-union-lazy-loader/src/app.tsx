import { lazy, Suspense } from "react";

declare const shouldLoadPanel: boolean;

const Panel = () => <p>loaded panel</p>;
const LazyPanel = lazy(() => Promise.resolve({ default: shouldLoadPanel ? Panel : 42 }));

export const App = () => (
  <Suspense fallback={<p>loading panel</p>}>
    <LazyPanel />
  </Suspense>
);
