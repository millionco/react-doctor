import { Component } from "react";

export class ResizeListener extends Component {
  handleResize() {}

  componentDidMount() {
    window.addEventListener("resize", this.handleResize, true);
  }

  componentWillUnmount() {
    window.removeEventListener("resize", this.handleResize, false);
  }

  render() {
    return null;
  }
}
