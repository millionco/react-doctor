// rule: no-did-mount-set-state
// weakness: wrapper-transparency
// source: PR #1506 Bugbot review
// verdict: pass

import { Component } from "react";

class Calendar extends Component {
  monthContainer = undefined;

  setMonthContainerRef = (element) => {
    this.monthContainer = element ?? undefined;
  };

  componentDidMount() {
    this.setState({ monthContainer: this.monthContainer });
  }

  render() {
    return <div ref={(element) => this.setMonthContainerRef(element)} />;
  }
}
