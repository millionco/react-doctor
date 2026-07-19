import React from "react";

export class NonNullRefReceiver extends React.Component {
  containerRef = React.createRef<HTMLDivElement>();

  componentDidMount() {
    this.containerRef.current!.addEventListener("wheel", this.handleWheel);
  }

  handleWheel = () => {};

  render() {
    return <div ref={this.containerRef} />;
  }
}
