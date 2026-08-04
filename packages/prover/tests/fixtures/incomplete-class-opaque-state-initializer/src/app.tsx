import { Component } from "react";

interface CounterState {
  count: number;
}

declare const createInitialState: () => CounterState;

export class Counter extends Component<Record<string, never>, CounterState> {
  state = createInitialState();

  render() {
    return <output>{this.state.count}</output>;
  }
}
