// rule: no-did-mount-set-state
// weakness: alias-guard
// source: PR #1506 Bugbot review
// verdict: fail

import { Component } from "react";

class Calendar extends Component {
  monthContainer = undefined;

  setMonthContainerRef = (element) => {
    this.monthContainer = element ?? undefined;
  };

  componentDidMount() {
    const instance = this;
    instance.setMonthContainerRef(this.props.monthContainer);
    this.setState({ monthContainer: this.monthContainer });
  }

  render() {
    return <div ref={this.setMonthContainerRef} />;
  }
}
