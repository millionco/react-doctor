import { Component } from "react";

interface CounterState {
  count: number;
}

export class Counter extends Component<Record<string, never>, CounterState> {
  constructor(properties: Record<string, never>) {
    super(properties);
    this.setState({ count: 0 });
  }

  render() {
    return null;
  }
}
