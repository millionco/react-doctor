// rule: class-component-missing-component-will-unmount-teardown
// weakness: library-idiom
// source: synthetic
// verdict: pass
import * as React from "react";
export class Panel extends React.PureComponent {
  node;
  captureNode = (value) => {
    this.node = value;
  };
  handleScroll = () => {};
  componentDidMount() {
    this.node.addEventListener("scroll", this.handleScroll, { passive: true });
  }
  componentWillUnmount() {
    this.node.removeEventListener("scroll", this.handleScroll);
  }
  render() {
    return <div ref={this.captureNode} />;
  }
}
