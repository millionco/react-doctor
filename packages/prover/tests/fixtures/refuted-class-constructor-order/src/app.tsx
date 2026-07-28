import { Component } from "react";

interface CounterState {
  count: number;
}

export class Counter extends Component<Record<string, never>, CounterState> {
  constructor(properties: Record<string, never>) {
    const initialCount = 0;
    super(properties);
    this.state = { count: initialCount };
  }

  render() {
    return <output>{this.state.count}</output>;
  }
}
