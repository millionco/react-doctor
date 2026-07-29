import { Component, lazy, Suspense } from "react";

const LazyPanel = lazy(() => import("./panel"));

export class App extends Component {
  render() {
    return (
      <Suspense fallback={<p>loading panel</p>}>
        <LazyPanel />
      </Suspense>
    );
  }
}
