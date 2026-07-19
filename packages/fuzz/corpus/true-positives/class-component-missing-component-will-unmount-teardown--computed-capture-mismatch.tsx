import React from "react";

export class ResizeTracker extends React.Component {
  handleResize = () => {};

  componentDidMount() {
    window.addEventListener("resize", this.handleResize, { [`capture`]: true });
    window.removeEventListener("resize", this.handleResize, { capture: false });
  }

  render() {
    return null;
  }
}
