// rule: no-did-mount-set-state
// weakness: control-flow
// source: Cursor Bugbot PR #1506
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
    class NestedCalendar {
      readHandler() {
        const instance = this;
        return instance.setMonthContainerRef;
      }
    }

    return <div ref={this.setMonthContainerRef} />;
  }
}
