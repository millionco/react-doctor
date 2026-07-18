// rule: no-did-update-set-state
// weakness: control-flow
// source: PR 1335 review

import React from "react";

interface CalendarState {
  monthContainer: HTMLDivElement | null;
}

export class Calendar extends React.Component<Record<string, never>, CalendarState> {
  state: CalendarState = { monthContainer: null };
  monthContainer: HTMLDivElement | null = null;

  componentDidUpdate() {
    if (this.state.monthContainer === this.monthContainer) {
      this.measureContainer();
    } else {
      this.setState({ monthContainer: this.monthContainer });
    }
  }

  measureContainer() {}

  render() {
    return <div ref={(node) => (this.monthContainer = node)} />;
  }
}
