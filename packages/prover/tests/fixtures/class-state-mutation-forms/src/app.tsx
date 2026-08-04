import { Component } from "react";

interface MutationState {
  count: number;
  items: string[];
  metadata: Map<string, string>;
  optional?: string;
}

export class MutationForms extends Component<Record<string, never>, MutationState> {
  componentDidMount() {
    this.state.count += 1;
    this.state.count++;
    delete this.state.optional;
    this.state.items.splice(0, 1);
    this.state.metadata.set("status", "ready");
    Object.assign(this.state, { count: 2 });
  }

  render() {
    return null;
  }
}
