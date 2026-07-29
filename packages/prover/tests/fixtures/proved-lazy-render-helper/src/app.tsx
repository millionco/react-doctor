import { lazy, Suspense } from "react";

const LazyPanel = lazy(() => import("./panel"));
const renderPanel = () => <LazyPanel />;

export const App = () => <Suspense fallback={<p>loading panel</p>}>{renderPanel()}</Suspense>;
