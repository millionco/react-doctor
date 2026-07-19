// rule: no-did-update-set-state
// weakness: callback-ref-overwrite
// source: PR 1335 review

import React from "react";

interface CalendarState {
  monthContainer: HTMLDivElement | undefined;
}

export class Calendar extends React.Component<Record<string, never>, CalendarState> {
  state: CalendarState = { monthContainer: undefined };
  monthContainer: HTMLDivElement | undefined = undefined;

  componentDidUpdate() {
    if (this.state.monthContainer !== this.monthContainer) {
      this.setState({ monthContainer: this.monthContainer });
    }
  }

  render() {
    return (
      <div
        ref={(node) => {
          this.monthContainer = node ?? undefined;
          this.monthContainer = undefined;
        }}
      />
    );
  }
}
