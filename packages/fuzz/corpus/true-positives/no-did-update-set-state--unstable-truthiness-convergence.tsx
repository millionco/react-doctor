// rule: no-did-update-set-state
// weakness: unstable-convergence
// source: ReactBench RDFPFN792026 adversarial control

import React from "react";

interface CalendarState {
  tooltip: string | undefined;
}

export class Calendar extends React.Component<Record<string, never>, CalendarState> {
  state: CalendarState = { tooltip: undefined };
  tooltip: string | undefined = undefined;

  componentDidUpdate() {
    if (!this.state.tooltip && this.tooltip) {
      this.setState({ tooltip: this.tooltip });
    }
  }

  render() {
    return this.state.tooltip;
  }
}
