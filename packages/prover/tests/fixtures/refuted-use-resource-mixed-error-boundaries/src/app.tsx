import { Component, Suspense, use } from "react";
import type { ReactNode } from "react";

interface BoundaryProperties {
  children: ReactNode;
  fallback: ReactNode;
}

interface BoundaryState {
  hasError: boolean;
}

class ValidBoundary extends Component<BoundaryProperties, BoundaryState> {
  state = { hasError: false };

  static getDerivedStateFromError(_error: unknown) {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) return this.props.fallback;
    return this.props.children;
  }
}

class InvalidBoundary extends Component<BoundaryProperties, BoundaryState> {
  state = { hasError: false };

  static getDerivedStateFromError(_error: unknown) {
    return { hasError: false };
  }

  render() {
    if (this.state.hasError) return this.props.fallback;
    return this.props.children;
  }
}

const messageResource = Promise.resolve("ready");

const ResourcePanel = () => <p>{use(messageResource)}</p>;

const ValidPath = () => (
  <ValidBoundary fallback={<p>failed</p>}>
    <Suspense fallback={<p>loading</p>}>
      <ResourcePanel />
    </Suspense>
  </ValidBoundary>
);

const InvalidPath = () => (
  <InvalidBoundary fallback={<p>failed</p>}>
    <Suspense fallback={<p>loading</p>}>
      <ResourcePanel />
    </Suspense>
  </InvalidBoundary>
);

export const App = () => (
  <>
    <ValidPath />
    <InvalidPath />
  </>
);
