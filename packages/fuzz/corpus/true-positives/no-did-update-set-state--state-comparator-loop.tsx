// rule: no-did-update-set-state
// weakness: unstable-comparator
// source: Cursor Bugbot on PR #1495

import React from "react";

interface CalendarState {
  openToDate: Date;
}

export class Calendar extends React.Component<Record<string, never>, CalendarState> {
  state: CalendarState = { openToDate: new Date() };

  componentDidUpdate(_: Record<string, never>, previousState: CalendarState) {
    if (!isEqual(this.state.openToDate, previousState.openToDate)) {
      this.setState({ openToDate: computeOpenToDate() });
    }
  }

  render() {
    return this.state.openToDate.toISOString();
  }
}
