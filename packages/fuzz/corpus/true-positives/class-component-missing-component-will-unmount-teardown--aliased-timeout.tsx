// rule: class-component-missing-component-will-unmount-teardown
// weakness: callback-alias
// source: proactive PR #1365 resource-order audit

import React from "react";

export class Banner extends React.Component {
  tick(): void {
    this.setState({ visible: true });
  }

  componentDidMount(): void {
    const callback = this.tick.bind(this);
    const callbackAlias = callback;
    setTimeout(callbackAlias, 3000);
  }

  render(): React.ReactNode {
    return null;
  }
}
