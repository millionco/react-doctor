// rule: no-did-update-set-state
// weakness: callback-ref-provenance
// source: react-bench fix-react-rdh-hacker0x01-react-d__2LSzsbc

import React from "react";

export class Calendar extends React.Component {
  state = { monthContainer: undefined };
  monthContainer: HTMLDivElement | undefined = undefined;

  componentDidUpdate() {
    if (this.props.showTimeSelect && this.state.monthContainer !== this.monthContainer) {
      this.setState({ monthContainer: this.monthContainer });
    }
  }

  render() {
    return (
      <div
        ref={(div) => {
          this.monthContainer = div ?? undefined;
        }}
      />
    );
  }
}
