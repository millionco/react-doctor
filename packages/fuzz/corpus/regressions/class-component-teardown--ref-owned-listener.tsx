// rule: class-component-missing-component-will-unmount-teardown
// weakness: control-flow
// source: PR #1000 adversarial review (ref-owned node dies with the component)
import * as React from "react";

export class Chart extends React.Component {
  containerRef = React.createRef<HTMLDivElement>();
  handleWheel = () => {};
  componentDidMount() {
    this.containerRef.current?.addEventListener("wheel", this.handleWheel);
  }
  render() {
    return <div ref={this.containerRef} />;
  }
}
