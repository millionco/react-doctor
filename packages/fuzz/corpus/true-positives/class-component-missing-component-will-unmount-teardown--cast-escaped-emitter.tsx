import React from "react";

export class CastEscapedEmitter extends React.Component {
  componentDidMount() {
    const network = new Network();
    network.on("draw", this.draw);
    this.network = network as Network;
  }

  draw = () => {};

  render() {
    return null;
  }
}
