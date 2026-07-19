import React from "react";

export class Clock extends React.Component {
  componentDidMount() {
    window["setInterval"](() => this.forceUpdate(), 1000);
  }

  render() {
    return null;
  }
}
