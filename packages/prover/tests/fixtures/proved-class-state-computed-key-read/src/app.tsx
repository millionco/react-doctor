import { Component } from "react";

interface LookupState {
  key: string;
}

export class Lookup extends Component<Record<string, never>, LookupState> {
  componentDidMount() {
    const values: Record<string, number> = {};
    values[this.state.key] = 1;
  }

  render() {
    return null;
  }
}
