// rule: no-did-update-set-state
// verdict: pass
// weakness: operand-order
// source: Cursor Bugbot on PR #1495

import React from "react";

interface MeasurementState {
  measuredWidth: number;
  renderedWidth: number;
}

export class Measurement extends React.Component<Record<string, never>, MeasurementState> {
  state: MeasurementState = { measuredWidth: 0, renderedWidth: 0 };

  componentDidUpdate() {
    if (this.state.measuredWidth !== this.state.renderedWidth) {
      this.setState({ renderedWidth: this.state.measuredWidth });
    }
  }

  render() {
    return this.state.renderedWidth;
  }
}
