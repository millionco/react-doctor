// rule: class-component-missing-component-will-unmount-teardown
// weakness: proven-mobx-disposal
// source: Cursor Bugbot review of PR #1365
import { disposeOnUnmount as dispose } from "mobx-react";
import React from "react";

export class Viewport extends React.Component {
  componentDidMount() {
    window.addEventListener("resize", this.handleResize);
    dispose(this, () => window.removeEventListener("resize", this.handleResize));
  }
  handleResize = () => {};
  render() {
    return null;
  }
}
