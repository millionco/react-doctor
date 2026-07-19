// rule: class-component-missing-component-will-unmount-teardown
// weakness: control-flow
// source: PR #1365 deep audit
import React from "react";

export class Preview extends React.Component {
  componentDidMount() {
    setTimeout(() => this.logReady(), 100);
  }

  logReady() {
    const unused = () => this.setState({ ready: true });
    console.log("ready", unused.name);
  }

  render() {
    return null;
  }
}
