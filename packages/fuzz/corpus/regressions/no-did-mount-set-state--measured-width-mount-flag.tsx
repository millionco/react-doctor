// rule: no-did-mount-set-state
// weakness: post-mount-source
// source: ReactBench relax/relax@75943ce5e9c4ce8f503398487b35f89cf4974d7e
// verdict: pass

import { Component } from "react";
import { findDOMNode } from "react-dom";

class Image extends Component {
  componentDidMount() {
    const dom = findDOMNode(this);
    const rect = dom.getBoundingClientRect();
    const width = Math.round(rect.right - rect.left);
    this.setState({
      mounted: true,
      width,
    });
  }
}
