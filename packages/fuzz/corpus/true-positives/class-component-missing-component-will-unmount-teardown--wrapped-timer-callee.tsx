// rule: class-component-missing-component-will-unmount-teardown
// weakness: wrapper-transparency
// source: Cursor Bugbot review of PR #1365

import React from "react";

export class Clock extends React.Component {
  componentDidMount(): void {
    (window.setInterval as typeof window.setInterval)(() => this.forceUpdate(), 1000);
  }

  render(): React.ReactNode {
    return null;
  }
}
