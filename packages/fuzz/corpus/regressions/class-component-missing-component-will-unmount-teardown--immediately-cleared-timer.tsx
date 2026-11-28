// rule: class-component-missing-component-will-unmount-teardown
// verdict: pass
// weakness: control-flow
// source: synthetic class mount that immediately clears its own timer

import { Component } from "react";

export class Clock extends Component {
  componentDidMount() {
    const timer = setInterval(() => this.forceUpdate(), 1_000);
    clearInterval(timer);
  }

  render() {
    return null;
  }
}
