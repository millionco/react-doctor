// rule: no-did-mount-set-state
// weakness: immediate-execution
// source: PR #1506 Bugbot review
// verdict: pass

import { Component } from "react";

class Calendar extends Component {
  monthContainer = undefined;

  setMonthContainerRef = (element) => {
    this.monthContainer = element ?? undefined;
  };

  componentDidMount() {
    (() => {
      const height = this.monthContainer.clientHeight;
      this.setState({ height });
    })();
  }

  render() {
    return <div ref={this.setMonthContainerRef} />;
  }
}
