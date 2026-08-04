import { Component } from "react";

interface ClockState {
  initializedAt: number;
}

export class Clock extends Component<Record<string, never>, ClockState> {
  state = { initializedAt: 0 };
  initializedAt = Date.now();

  render() {
    return <output>{this.initializedAt + this.state.initializedAt}</output>;
  }
}
