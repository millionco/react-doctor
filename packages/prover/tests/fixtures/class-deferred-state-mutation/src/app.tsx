import { Component } from "react";

interface ListenerState {
  resizeCount: number;
}

export class ResizeListener extends Component<Record<string, never>, ListenerState> {
  handleResize() {
    this.state.resizeCount += 1;
  }

  componentDidMount() {
    window.addEventListener("resize", this.handleResize);
  }

  componentWillUnmount() {
    window.removeEventListener("resize", this.handleResize);
  }

  render() {
    return null;
  }
}
