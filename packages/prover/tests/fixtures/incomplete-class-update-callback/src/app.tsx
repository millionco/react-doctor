import { Component } from "react";

interface ReadyState {
  ready: boolean;
}

export class ReadyIndicator extends Component<Record<string, never>, ReadyState> {
  componentDidMount() {
    this.setState({ ready: true }, () => {
      window.dispatchEvent(new Event("ready"));
    });
  }

  render() {
    return null;
  }
}
