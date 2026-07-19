// rule: class-component-missing-component-will-unmount-teardown
// weakness: proven-mobx-disposal
// source: Cursor Bugbot review of PR #1365
import React from "react";

const disposeOnUnmount = (_owner: unknown, cleanup: () => void) => cleanup;

export class Viewport extends React.Component {
  componentDidMount() {
    window.addEventListener("resize", this.handleResize);
    disposeOnUnmount(this, () => window.removeEventListener("resize", this.handleResize));
  }
  handleResize = () => {};
  render() {
    return null;
  }
}
