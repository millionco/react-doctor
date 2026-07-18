// rule: no-did-update-set-state
// weakness: private-member
// source: adversarial fuzz review of PR #1335

import React from "react";

export class Calendar extends React.Component {
  #monthContainer: HTMLDivElement | undefined;

  #setMonthContainer = (node: HTMLDivElement | null) => {
    this.#monthContainer = node ?? undefined;
  };

  componentDidUpdate() {
    if (this.state.monthContainer !== this.#monthContainer) {
      this.setState({ monthContainer: this.#monthContainer });
    }
  }

  render() {
    return <div ref={this.#setMonthContainer} />;
  }
}
