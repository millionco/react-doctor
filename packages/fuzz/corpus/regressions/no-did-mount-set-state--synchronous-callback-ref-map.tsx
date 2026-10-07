// rule: no-did-mount-set-state
// weakness: control-flow
// source: Cursor Bugbot PR #1506
// verdict: pass

import { Component } from "react";

class Gallery extends Component {
  measuredElement = undefined;

  setMeasuredElementRef = (element) => {
    this.measuredElement = element ?? undefined;
  };

  componentDidMount() {
    const elements = [0].map(() => this.measuredElement);
    this.setState({ elements });
  }

  render() {
    return <div ref={this.setMeasuredElementRef} />;
  }
}
