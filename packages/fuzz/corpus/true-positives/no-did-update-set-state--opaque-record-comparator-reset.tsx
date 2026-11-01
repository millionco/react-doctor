// rule: no-did-update-set-state
// verdict: fail
// weakness: unstable-comparator
// source: synthetic opaque state-record producer
// oxlint-disable react/no-did-update-set-state -- fixture exercises React Doctor lifecycle diagnostics

import { Component } from "react";
import compare from "react-fast-compare";

declare const computeRecord: () => Record<string, boolean>;

interface EmptyRecordState {
  record: Record<string, boolean>;
}

export class OpaqueRecordPanel extends Component<Record<string, never>, EmptyRecordState> {
  state: EmptyRecordState = { record: { enabled: true } };

  componentDidUpdate(previousProps: Record<string, never>, previousState: EmptyRecordState) {
    if (!compare(previousState.record, this.state.record)) {
      this.setState({ record: computeRecord() });
    }
  }

  render() {
    return null;
  }
}
