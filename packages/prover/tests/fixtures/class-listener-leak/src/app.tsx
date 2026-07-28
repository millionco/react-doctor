import { Component } from "react";

export class ResizeListener extends Component {
  handleResize() {}

  componentDidMount() {
    window.addEventListener("resize", this.handleResize);
  }

  render() {
    return null;
  }
}
