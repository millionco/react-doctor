import React from "react";

export class ResizeTracker extends React.Component {
  handleResize = () => {};

  componentDidMount() {
    window["addEventListener"]("resize", this.handleResize);
    window[`removeEventListener`]("resize", this.handleResize);
  }

  render() {
    return null;
  }
}
