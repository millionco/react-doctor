// rule: no-did-mount-set-state
// weakness: control-flow
// source: Cursor Bugbot PR #1506
// verdict: fail

import { Component } from "react";

class Calendar extends Component {
  monthContainer = undefined;

  setMonthContainerRef = (element) => {
    this.monthContainer = element ?? undefined;
  };

  render() {
    const calendar = this;
    class NestedCalendar {
      overwriteMonthContainer(value) {
        calendar.monthContainer = value;
      }
    }
    return <div ref={this.setMonthContainerRef} />;
  }

  componentDidMount() {
    this.setState({ monthContainer: this.monthContainer });
  }
}
