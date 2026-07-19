// rule: class-component-missing-component-will-unmount-teardown
// weakness: alias-guard
// source: Cursor Bugbot review of PR #1365

import React from "react";

const externalNetwork = { on() {} };
class Network {
  on() {}
}

export class Legend extends React.Component {
  componentDidMount() {
    const network = new Network();
    {
      const network = externalNetwork;
      this.network = network;
    }
    network.on("draw", this.draw);
  }

  render() {
    return null;
  }
}
