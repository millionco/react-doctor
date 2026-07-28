import { Component } from "react";

const customTarget = {
  addEventListener(_eventName: string, _callback: () => void) {},
};

export class ResizeListener extends Component {
  constructor(properties: Record<string, unknown>) {
    super(properties);
    customTarget.addEventListener("resize", () => {});
  }

  render() {
    return null;
  }
}
