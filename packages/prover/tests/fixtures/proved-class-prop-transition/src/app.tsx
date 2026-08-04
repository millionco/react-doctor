import { Component } from "react";

interface DraftProperties {
  value: string;
}

interface DraftState {
  draft: string;
}

export class DraftEditor extends Component<DraftProperties, DraftState> {
  componentDidUpdate(previousProperties: DraftProperties) {
    if (previousProperties.value !== this.props.value) {
      this.setState({ draft: this.props.value });
    }
  }

  render() {
    return <output>{this.props.value}</output>;
  }
}
