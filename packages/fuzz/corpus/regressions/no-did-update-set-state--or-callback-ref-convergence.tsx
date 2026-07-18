// rule: no-did-update-set-state
// weakness: control-flow
// source: PR 1335 review

import React from "react";

interface CalendarState {
  primaryContainer: HTMLDivElement | undefined;
  secondaryContainer: HTMLDivElement | undefined;
}

export class Calendar extends React.Component<Record<string, never>, CalendarState> {
  state: CalendarState = { primaryContainer: undefined, secondaryContainer: undefined };
  primaryContainer: HTMLDivElement | undefined = undefined;
  secondaryContainer: HTMLDivElement | undefined = undefined;

  componentDidUpdate() {
    if (
      this.state.primaryContainer !== this.primaryContainer ||
      this.state.secondaryContainer !== this.secondaryContainer
    ) {
      this.setState({
        primaryContainer: this.primaryContainer,
        secondaryContainer: this.secondaryContainer,
      });
    }
  }

  render() {
    return (
      <div
        ref={(node) => {
          this.primaryContainer = node ?? undefined;
          this.secondaryContainer = node ?? undefined;
        }}
      />
    );
  }
}
