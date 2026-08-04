import { Suspense } from "react";
import LazyRoute from "./lazy-route";

export const App = () => (
  <Suspense fallback={<p>loading route</p>}>
    <LazyRoute />
  </Suspense>
);
