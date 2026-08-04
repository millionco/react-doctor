import { Component } from "react";

export class Counter extends Component<Record<string, unknown>, number> {
  state = 0;

  render() {
    return <output>{this.state}</output>;
  }
}
