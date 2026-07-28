import { Component } from "react";

interface ConnectionState {
  connected: boolean;
}

export class Connection extends Component<Record<string, never>, ConnectionState> {
  componentWillUnmount() {
    this.state.connected = false;
  }

  render() {
    return null;
  }
}
