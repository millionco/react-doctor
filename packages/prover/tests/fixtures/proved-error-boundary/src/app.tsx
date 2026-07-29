import { Component } from "react";
import type { ReactNode } from "react";

interface ErrorBoundaryProperties {
  children: ReactNode;
  fallback: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

class ErrorBoundary extends Component<ErrorBoundaryProperties, ErrorBoundaryState> {
  state = { hasError: false };

  static getDerivedStateFromError(_error: unknown) {
    return { hasError: true };
  }

  componentDidCatch(_error: unknown) {}

  render() {
    if (this.state.hasError) return this.props.fallback;
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
