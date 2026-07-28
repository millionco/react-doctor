import { Component } from "react";

interface CounterProperties {
  initialCount: number;
}

interface CounterState {
  count: number;
}

export class Counter extends Component<CounterProperties, CounterState> {
  initialCount = this.props.initialCount;
  state = { count: this.props.initialCount };

  render() {
    return <output>{this.initialCount + this.state.count}</output>;
  }
}
