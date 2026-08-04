import { Component } from "react";

interface CounterState {
  count: number;
}

export class Counter extends Component<Record<string, never>, CounterState> {
  render() {
    return <output>{this.state.count}</output>;
  }
}
