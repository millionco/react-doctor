import { lazy, Suspense } from "react";

const LazyPanel = lazy(() => import("./panel"));
const routes = { Panel: LazyPanel };

export const App = () => (
  <Suspense fallback={<p>loading panel</p>}>
    <routes.Panel />
  </Suspense>
);
