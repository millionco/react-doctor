import { Component } from "react";

export class ResizeListener extends Component {
  handleResize() {}

  attach() {
    window.addEventListener("resize", this.handleResize);
  }

  detach() {
    window.removeEventListener("resize", this.handleResize);
  }

  componentDidMount() {
    this.attach();
  }

  componentWillUnmount() {
    this.detach();
  }

  render() {
    return null;
  }
}
