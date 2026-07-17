// rule: class-component-missing-component-will-unmount-teardown
// source: Cursor Bugbot review of PR #1365

import React from "react";

export class Tracker extends React.Component {
  componentDidMount(): void {
    window.addEventListener("resize", this.handleResize);
  }

  ["componentWillUnmount"](): void {
    window.removeEventListener("resize", this.handleResize);
  }

  handleResize = (): void => {};

  render(): React.ReactNode {
    return null;
  }
}
