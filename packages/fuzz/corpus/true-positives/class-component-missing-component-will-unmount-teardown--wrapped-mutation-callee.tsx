// rule: class-component-missing-component-will-unmount-teardown
// weakness: wrapper-transparency
// source: Cursor Bugbot review of PR #1365

import React from "react";

export class Banner extends React.Component {
  componentDidMount(): void {
    setTimeout(() => {
      (this.setState as typeof this.setState)({ visible: true });
    }, 100);
  }

  render(): React.ReactNode {
    return null;
  }
}
