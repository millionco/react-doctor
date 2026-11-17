// rule: no-did-update-set-state
// verdict: pass
// weakness: library-idiom
// source: synthetic empty-record convergence regression
// oxlint-disable react/no-did-update-set-state -- fixture exercises React Doctor lifecycle diagnostics

import { Component } from "react";
import compare from "react-fast-compare";

interface EmptyRecordState {
  record: Record<string, boolean>;
}

export class EmptyRecordPanel extends Component<Record<string, never>, EmptyRecordState> {
  state: EmptyRecordState = { record: { enabled: true } };

  componentDidUpdate(previousProps: Record<string, never>, previousState: EmptyRecordState) {
    if (!compare(previousState.record, this.state.record)) {
      this.setState({ record: {} });
    }
  }

  render() {
    return null;
  }
}
