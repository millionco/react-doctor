import { Component } from "react";

interface CounterState {
  count: number;
}

export class Counter extends Component<Record<string, never>, CounterState> {
  componentDidMount() {
    const stateAlias = this.state;
    stateAlias.count = 1;
  }

  render() {
    return <output>{this.state.count}</output>;
  }
}
