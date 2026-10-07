// rule: no-did-mount-set-state
// weakness: control-flow
// source: ReactBench justinrhodes1/react-power-tooltip@fb2df8120e0d64ed81c53fcaaef845157f1a9e0c
// verdict: pass

import React, { Component } from "react";

class TextBox extends Component {
  componentDidMount() {
    const heights = Object.keys(this.spanHeights).map((key) => this.spanHeights[key].clientHeight);
    const firstH = heights[0];
    const lastH = heights[heights.length - 1];
    const totH = heights.reduce((accumulator, currentValue) => accumulator + currentValue, 0);
    this.setState({ totH, firstH, lastH });
  }

  render() {
    this.spanHeights = {};
    return React.Children.map(this.props.children, (child, index) =>
      React.cloneElement(child, {
        ref: (span) => (this.spanHeights[`span${index + 1}`] = span),
      }),
    );
  }
}
