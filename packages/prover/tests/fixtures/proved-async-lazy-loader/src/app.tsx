import { lazy, Suspense } from "react";
import Panel from "./panel";

const LazyPanel = lazy(async () => ({ default: Panel }));

export const App = () => (
  <Suspense fallback={<p>loading panel</p>}>
    <LazyPanel />
  </Suspense>
);
