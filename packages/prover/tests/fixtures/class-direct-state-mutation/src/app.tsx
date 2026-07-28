import { Component } from "react";

interface CounterState {
  count: number;
}

export class Counter extends Component<Record<string, never>, CounterState> {
  componentDidMount() {
    this.state.count = 1;
  }

  render() {
    return <output>{this.state.count}</output>;
  }
}
