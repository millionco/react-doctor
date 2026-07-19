// rule: class-component-missing-component-will-unmount-teardown
// weakness: call-graph
// source: Cursor Bugbot review of PR #1365

import React from "react";

export class Banner extends React.Component {
  show = (): void => this.reveal();
  reveal = (): void => this.setState({ visible: true });

  componentDidMount(): void {
    setTimeout(() => this.show(), 3000);
  }

  render(): React.ReactNode {
    return null;
  }
}
