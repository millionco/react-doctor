import { Component } from "react";

interface QueueState {
  items: string[];
}

export class Queue extends Component<Record<string, never>, QueueState> {
  componentDidUpdate() {
    this.state.items.push("queued");
  }

  render() {
    return <output>{this.state.items.length}</output>;
  }
}
