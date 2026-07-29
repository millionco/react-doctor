// rule: no-did-update-set-state
// weakness: unstable-convergence
// source: Bugbot review on ReactBench RDFPFN792026

import React from "react";

interface TooltipState {
  nextTooltip: string;
  tooltip: string;
}

export class Tooltip extends React.Component<Record<string, never>, TooltipState> {
  state: TooltipState = { nextTooltip: "", tooltip: "" };

  componentDidUpdate() {
    if (this.state.tooltip !== this.state.nextTooltip) {
      this.setState({
        tooltip: this.state.nextTooltip,
        nextTooltip: computeNextTooltip(),
      });
    }
  }

  render() {
    return this.state.tooltip;
  }
}
