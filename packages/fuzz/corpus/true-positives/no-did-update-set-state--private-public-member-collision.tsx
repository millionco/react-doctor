// rule: no-did-update-set-state
// weakness: private-member
// source: PR 1335 Bugbot review

import React from "react";

export class Calendar extends React.Component {
  #node: HTMLDivElement | null = null;

  #setNode = (node: HTMLDivElement | null) => {
    this.#node = node;
  };

  componentDidUpdate() {
    if (this.state.node !== this.node) {
      this.setState({ node: this.node });
    }
  }

  render() {
    return <div ref={this.#setNode} />;
  }
}
