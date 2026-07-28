import { Component } from "react";

interface CounterState {
  count: number;
}

export class Counter extends Component<Record<string, never>, CounterState> {
  componentDidMount() {
    const count = this.state.count;
    if (count < 0) this.setState(null);
  }

  render() {
    return <output>{this.state.count}</output>;
  }
}
