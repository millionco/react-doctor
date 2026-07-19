// rule: class-component-missing-component-will-unmount-teardown
// weakness: wrapper-transparency
// source: Cursor Bugbot review of PR #1365

import React from "react";

export class Banner extends React.Component {
  tick(): void {
    this.setState({ visible: true });
  }

  componentDidMount(): void {
    setTimeout((this.tick.bind as typeof this.tick.bind)(this), 3000);
  }

  render(): React.ReactNode {
    return null;
  }
}
