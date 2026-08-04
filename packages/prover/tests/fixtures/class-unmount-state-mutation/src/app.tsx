import { Component } from "react";

interface ConnectionState {
  connected: boolean;
}

export class Connection extends Component<Record<string, never>, ConnectionState> {
  state = { connected: true };

  componentWillUnmount() {
    this.state.connected = false;
  }

  render() {
    return null;
  }
}
