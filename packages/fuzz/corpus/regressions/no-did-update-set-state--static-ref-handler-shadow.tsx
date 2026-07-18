// rule: no-did-update-set-state
// weakness: callback-ref-provenance
// source: Cursor Bugbot on PR #1335

import React from "react";

export class Calendar extends React.Component {
  static setMonthContainer = null;
  monthContainer: HTMLDivElement | undefined = undefined;

  setMonthContainer = (node: HTMLDivElement | null) => {
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
