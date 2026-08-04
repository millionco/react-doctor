import { Component } from "react";

interface RevisionState {
  revision: number;
}

export class RevisionTracker extends Component<Record<string, never>, RevisionState> {
  state = { revision: 0 };

  componentDidUpdate() {
    this.setState({ revision: 1 });
  }

  render() {
    return null;
  }
}
