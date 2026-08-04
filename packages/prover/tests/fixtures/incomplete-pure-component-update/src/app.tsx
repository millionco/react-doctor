import { PureComponent } from "react";

interface RevisionState {
  revision: number;
}

export class RevisionTracker extends PureComponent<Record<string, never>, RevisionState> {
  state = { revision: 0 };

  componentDidUpdate() {
    this.setState({ revision: 1 });
  }

  render() {
    return null;
  }
}
