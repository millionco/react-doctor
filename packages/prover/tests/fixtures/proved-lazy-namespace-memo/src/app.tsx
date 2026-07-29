import * as React from "react";

const LazyPanel = React.memo(React.lazy(() => import("./panel")));

export const App = () => (
  <React.Suspense fallback={<p>loading panel</p>}>
    <LazyPanel />
  </React.Suspense>
);
