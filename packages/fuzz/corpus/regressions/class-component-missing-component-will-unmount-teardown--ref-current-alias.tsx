// rule: class-component-missing-component-will-unmount-teardown
// weakness: ref-alias-provenance
// source: Cursor Bugbot review of PR #1365
import React from "react";

export class Chart extends React.Component {
  containerRef = React.createRef<HTMLDivElement>();
  componentDidMount() {
    const container = this.containerRef.current!;
    const localContainer = container;
    localContainer.addEventListener("wheel", this.handleWheel);
  }
  handleWheel = () => {};
  render() {
    return <div ref={this.containerRef} />;
  }
}
