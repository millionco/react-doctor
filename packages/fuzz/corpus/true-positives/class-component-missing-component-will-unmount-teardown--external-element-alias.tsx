// rule: class-component-missing-component-will-unmount-teardown
// weakness: ref-alias-provenance
// source: Cursor Bugbot review of PR #1365
import React from "react";

export class Chart extends React.Component {
  componentDidMount() {
    const target = document.body;
    target.addEventListener("wheel", this.handleWheel);
  }
  handleWheel = () => {};
  render() {
    return null;
  }
}
