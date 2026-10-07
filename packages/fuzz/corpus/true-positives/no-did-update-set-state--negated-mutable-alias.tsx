// rule: no-did-update-set-state
// verdict: fail
// weakness: unstable-guard-alias
// source: Cursor Bugbot on PR #1495

import React from "react";

interface TooltipProps {
  forceUpdate: boolean;
  tooltip: string;
}

interface TooltipState {
  tooltip: string;
}

export class Tooltip extends React.Component<TooltipProps, TooltipState> {
  state: TooltipState = { tooltip: "" };

  componentDidUpdate() {
    let isTooltipCurrent = this.state.tooltip === this.props.tooltip;
    isTooltipCurrent = this.props.forceUpdate;
    if (!isTooltipCurrent) {
      this.setState({ tooltip: this.props.tooltip });
    }
  }

  render() {
    return this.state.tooltip;
  }
}
