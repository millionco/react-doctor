import { Component } from "react";
import type { ReactNode } from "react";

interface ErrorBoundaryProperties {
  children: ReactNode;
  fallback: ReactNode;
}

class ErrorBoundary extends Component<ErrorBoundaryProperties, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(_error: unknown) {
    return { failed: true };
  }

  render() {
    if (this.state.failed) return this.props.fallback;
    return this.props.children;
  }
}

const Shell = ({ children }: { children: ReactNode }) => <section>{children}</section>;

const BrokenPanel = () => {
  throw new Error("panel failed");
};

export const App = () => (
  <ErrorBoundary fallback={<p>panel unavailable</p>}>
    <Shell>
      <BrokenPanel />
    </Shell>
  </ErrorBoundary>
);
