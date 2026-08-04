import { Component } from "react";

interface DraftProperties {
  value: string;
}

interface DraftState {
  draft: string;
}

export class DraftEditor extends Component<DraftProperties, DraftState> {
  componentDidUpdate({ value: previousValue }: DraftProperties) {
    if (previousValue !== this.props.value) {
      this.setState({ draft: this.props.value });
    }
  }

  render() {
    return null;
  }
}
