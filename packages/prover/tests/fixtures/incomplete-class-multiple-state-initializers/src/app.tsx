import { Component } from "react";

interface CounterState {
  count: number;
}

export class Counter extends Component<Record<string, never>, CounterState> {
  state = { count: 0 };

  constructor(properties: Record<string, never>) {
    super(properties);
    this.state = { count: 1 };
  }

  render() {
    return <output>{this.state.count}</output>;
  }
}
