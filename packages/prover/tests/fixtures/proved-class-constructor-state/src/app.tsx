import { Component } from "react";

interface CounterProperties {
  initialCount: number;
}

interface CounterState {
  count: number;
}

export class Counter extends Component<CounterProperties, CounterState> {
  constructor(properties: CounterProperties) {
    super(properties);
    this.state = { count: properties.initialCount };
  }

  render() {
    return <output>{this.state.count}</output>;
  }
}
