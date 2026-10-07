// rule: no-did-update-set-state
// verdict: pass
// weakness: guard-alias
// source: Cursor Bugbot on PR #1495

import React from "react";

interface TooltipProps {
  tooltip: string;
}

interface TooltipState {
  tooltip: string;
}

export class Tooltip extends React.Component<TooltipProps, TooltipState> {
  state: TooltipState = { tooltip: "" };

  componentDidUpdate() {
    const isTooltipCurrent = this.state.tooltip === this.props.tooltip;
    if (!isTooltipCurrent) {
      this.setState({ tooltip: this.props.tooltip });
    }
  }

  render() {
    return this.state.tooltip;
  }
}
