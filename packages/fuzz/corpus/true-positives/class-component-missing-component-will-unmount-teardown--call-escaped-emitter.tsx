import React from "react";
import { registry } from "./registry";

export class Preview extends React.Component {
  componentDidMount() {
    const emitter = new EventTarget();
    registry.add(emitter);
    emitter.addEventListener("change", () => this.setState({ ready: true }));
  }

  render() {
    return null;
  }
}
