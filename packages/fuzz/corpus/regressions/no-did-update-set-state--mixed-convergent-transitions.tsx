// rule: no-did-update-set-state
// weakness: control-flow
// source: ReactBench RDFPFN792026

import React from "react";

interface CalendarProps {
  enabled: boolean;
  tooltip: string;
}

interface CalendarState {
  tooltip: string;
}

export class Calendar extends React.Component<CalendarProps, CalendarState> {
  state: CalendarState = { tooltip: "" };

  componentDidUpdate(previousProps: CalendarProps) {
    if (
      this.props.enabled &&
      (this.state.tooltip !== this.props.tooltip || !previousProps.enabled)
    ) {
      this.setState({ tooltip: this.props.tooltip });
    }
  }

  render() {
    return this.state.tooltip;
  }
}
