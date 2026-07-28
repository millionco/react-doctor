import { Component } from "react";

interface CounterState {
  count: number;
}

export class Counter extends Component<Record<string, never>, CounterState> {
  state = { count: 0 };

  componentDidMount() {
    this.setState((previousState) => {
      console.log(previousState.count);
      return { count: previousState.count + 1 };
    });
  }

  render() {
    return null;
  }
}
