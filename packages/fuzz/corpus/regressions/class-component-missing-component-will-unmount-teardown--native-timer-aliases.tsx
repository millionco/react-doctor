// rule: class-component-missing-component-will-unmount-teardown
// weakness: alias-resolution
// source: synthetic audit regression

import React from "react";
export class Clock extends React.Component {
  componentDidMount() {
    this.timer = window.setInterval(() => this.setState({ tick: true }), 100);
  }
  componentWillUnmount() {
    globalThis.clearTimeout(this.timer);
  }
  render() {
    return null;
  }
}
