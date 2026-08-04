import { Component } from "react";

export class ResizeListener extends Component {
  constructor(properties: Record<string, unknown>) {
    super(properties);
    window.addEventListener("resize", () => {});
  }

  render() {
    return null;
  }
}
