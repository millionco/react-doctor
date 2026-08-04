import { Component } from "react";
import type { ReactNode } from "react";

class ErrorBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError(_error: unknown) {
    return {};
  }

  render() {
    if (this.state.failed) return this.props.fallback;
    return this.props.children;
  }
}

const BrokenPanel = () => {
  throw new Error("panel failed");
};

export const App = () => (
  <ErrorBoundary fallback={<p>panel unavailable</p>}>
    <BrokenPanel />
  </ErrorBoundary>
);
