// rule: no-did-update-set-state
// verdict: pass
// weakness: alias-guard
// source: synthetic local array-value comparison
// oxlint-disable react/no-did-update-set-state -- tests the custom guarded-update rule
import { Component } from "react";
function differs(previous = [], current = []) {
  return (
    previous.length !== current.length ||
    previous.some((value, index) => !Object.is(value, current[index]))
  );
}
export class Counter extends Component {
  state = { tick: 0 };
  componentDidUpdate(previous) {
    const { items } = this.props;
    if (differs(previous.items, items)) {
      this.setState({ tick: this.state.tick + 1 });
    }
  }
  render() {
    return null;
  }
}
