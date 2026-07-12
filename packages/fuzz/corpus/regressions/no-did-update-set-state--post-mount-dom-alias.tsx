// rule: no-did-update-set-state
// weakness: alias-guard
// source: react-bench write-react-tektoncd-dashboard-5019

import React from "react";

export class FormattedDuration extends React.Component {
  state = { tooltip: "" };
  durationNode: HTMLSpanElement | null = null;

  componentDidUpdate() {
    const renderedText = this.durationNode?.textContent ?? "";
    const tooltip = renderedText.trim();
    if (this.state.tooltip !== tooltip) {
      this.setState({ tooltip });
    }
  }

  render() {
    return <span ref={(node) => (this.durationNode = node)}>duration</span>;
  }
}
