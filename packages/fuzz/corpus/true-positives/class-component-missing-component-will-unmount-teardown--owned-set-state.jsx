// rule: class-component-missing-component-will-unmount-teardown
// weakness: name-heuristic
// source: Cursor Bugbot review of PR #1365

import React from "react";

export class Banner extends React.Component {
  setState(nextState) {
    super.setState(nextState);
  }

  componentDidMount() {
    setTimeout(() => this.setState({ ready: true }), 100);
  }

  render() {
    return null;
  }
}
