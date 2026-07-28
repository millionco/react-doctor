import { Component } from "react";

interface CounterProperties {
  enabled: boolean;
}

interface CounterState {
  count: number;
}

export class Counter extends Component<CounterProperties, CounterState> {
  componentDidMount() {
    const stateAlias = this.props.enabled ? this.state : { count: 0 };
    stateAlias.count = 1;
  }

  render() {
    return <output>{this.state.count}</output>;
  }
}
