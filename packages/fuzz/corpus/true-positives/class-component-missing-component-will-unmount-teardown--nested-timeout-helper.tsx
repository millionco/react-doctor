// rule: class-component-missing-component-will-unmount-teardown
// weakness: callback-flow
// source: Cursor Bugbot review of PR #1365

import React from "react";

export class App extends React.Component {
  componentDidMount(): void {
    setTimeout(() => {
      const updateReady = () => this.setState({ ready: true });
      const runUpdate = updateReady;
      runUpdate();
    }, 500);
  }

  render(): React.ReactNode {
    return <div />;
  }
}
