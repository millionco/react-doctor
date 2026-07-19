// rule: no-did-update-set-state
// weakness: default-parameter
// source: PR 1335 review

import React from "react";

interface CalendarState {
  monthContainer: HTMLDivElement | undefined;
}

export class Calendar extends React.Component<Record<string, never>, CalendarState> {
  state: CalendarState = { monthContainer: undefined };
  monthContainer: HTMLDivElement | undefined = undefined;

  setMonthContainer = (node: HTMLDivElement | null = null) => {
    this.monthContainer = node ?? undefined;
  };

  componentDidUpdate() {
    if (this.state.monthContainer !== this.monthContainer) {
      this.setState({ monthContainer: this.monthContainer });
    }
  }

  render() {
    return <div ref={this.setMonthContainer} />;
  }
}
