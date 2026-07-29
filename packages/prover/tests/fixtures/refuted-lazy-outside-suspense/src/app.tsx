import { lazy } from "react";

const LazyPanel = lazy(() => import("./lazy-panel"));

const PanelRoute = () => <LazyPanel />;

export const App = () => <PanelRoute />;
