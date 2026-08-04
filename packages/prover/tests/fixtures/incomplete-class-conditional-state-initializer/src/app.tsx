import { Component } from "react";

interface CounterProperties {
  enabled: boolean;
}

interface CounterState {
  count: number;
}

export class Counter extends Component<CounterProperties, CounterState> {
  constructor(properties: CounterProperties) {
    super(properties);
    if (properties.enabled) {
      this.state = { count: 0 };
    }
  }

  render() {
    return <output>{this.state.count}</output>;
  }
}
