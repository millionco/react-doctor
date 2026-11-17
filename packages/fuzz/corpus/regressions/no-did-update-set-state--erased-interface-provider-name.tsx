// rule: no-did-update-set-state
// weakness: name-heuristic
// source: synthetic erased type metadata around convergent empty-record reset
// verdict: pass

interface Note {
  nested: { Object: string };
}
import React from "react";
import compare from "react-fast-compare";
export class Panel extends React.Component {
  state = { hidden: true, record: { enabled: true }, other: 0 };
  componentDidUpdate(previousProps, previousState) {
    if (!compare(previousState.record, this.state.record)) {
      this.setState({ record: {} });
    }
  }
  render() {
    return null;
  }
}
