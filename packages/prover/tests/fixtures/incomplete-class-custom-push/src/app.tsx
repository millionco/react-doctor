import { Component } from "react";

interface PersistentQueue {
  push(value: string): PersistentQueue;
}

interface QueueState {
  queue: PersistentQueue;
}

export class Queue extends Component<Record<string, never>, QueueState> {
  state: QueueState = {
    queue: {
      push() {
        return this;
      },
    },
  };

  componentDidMount() {
    this.state.queue.push("queued");
  }

  render() {
    return null;
  }
}
