import { Component } from "react";

interface Model {
  version: number;
}

interface ModelProperties {
  model: Model;
}

interface ModelState {
  observedVersion: number;
}

export class ModelObserver extends Component<ModelProperties, ModelState> {
  componentDidUpdate(previousProperties: ModelProperties) {
    if (previousProperties.model.version !== this.props.model.version) {
      this.setState({ observedVersion: this.props.model.version });
    }
  }

  render() {
    return null;
  }
}
