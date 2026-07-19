import React from "react";

export class CastGlobalTimer extends React.Component {
  componentDidMount() {
    (window as Window).setInterval(() => this.forceUpdate(), 1000);
  }

  render() {
    return null;
  }
}
