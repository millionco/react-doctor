import { Component } from "react";

interface CounterState {
  count: number;
}

declare const normalizeCounter: (state: Readonly<CounterState>) => CounterState;

export class Counter extends Component<Record<string, never>, CounterState> {
  componentDidMount() {
    this.setState((previousState) => normalizeCounter(previousState));
  }

  render() {
    return null;
  }
}
