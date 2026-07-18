// rule: no-did-update-set-state
// weakness: alternate-branch-undefined-clear
// source: PR 1335 review

import React from "react";

export class Calendar extends React.Component {
  state = { monthContainer: undefined };

  componentDidUpdate() {
    if (this.state.monthContainer) {
      this.measureContainer();
    } else {
      this.setState({ monthContainer: undefined });
    }
  }

  measureContainer() {}
}
