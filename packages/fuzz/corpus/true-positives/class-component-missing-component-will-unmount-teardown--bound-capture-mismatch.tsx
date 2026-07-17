import React from "react";

export class ResizeTracker extends React.Component {
  handleResize = () => {};

  componentDidMount() {
    const captureOptions = { capture: true };
    window.addEventListener("resize", this.handleResize, captureOptions);
    window.removeEventListener("resize", this.handleResize, { capture: false });
  }

  render() {
    return null;
  }
}
