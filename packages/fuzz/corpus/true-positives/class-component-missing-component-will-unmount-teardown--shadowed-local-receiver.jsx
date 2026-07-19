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
    const network = externalNetwork;
    {
      const network = new Network();
      void network;
    }
    network.on("draw", this.draw);
  }

  render() {
    return null;
  }
}
