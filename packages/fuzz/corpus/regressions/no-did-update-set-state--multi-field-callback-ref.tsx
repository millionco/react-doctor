// rule: no-did-update-set-state
// weakness: multi-field-callback-ref-provenance
// source: PR 1335 review

import React from "react";

export class Calendar extends React.Component {
  state = { primaryContainer: undefined };
  primaryContainer: HTMLDivElement | undefined = undefined;
  secondaryContainer: HTMLDivElement | undefined = undefined;

  componentDidUpdate() {
    if (this.state.primaryContainer !== this.primaryContainer) {
      this.setState({ primaryContainer: this.primaryContainer });
    }
  }

  render() {
    return (
      <div
        ref={(node) => {
          this.primaryContainer = node ?? undefined;
          this.secondaryContainer = node ?? undefined;
        }}
      />
    );
  }
}
