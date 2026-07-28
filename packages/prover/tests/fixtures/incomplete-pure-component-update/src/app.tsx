import { PureComponent } from "react";

interface RevisionState {
  revision: number;
}

export class RevisionTracker extends PureComponent<Record<string, never>, RevisionState> {
  componentDidUpdate() {
    this.setState({ revision: 1 });
  }

  render() {
    return null;
  }
}
