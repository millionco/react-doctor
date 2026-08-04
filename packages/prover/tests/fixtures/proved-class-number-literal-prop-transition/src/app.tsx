import { Component } from "react";

interface StepProperties {
  step: 0 | 1;
}

interface StepState {
  observedStep: 0 | 1;
}

export class StepObserver extends Component<StepProperties, StepState> {
  componentDidUpdate(previousProperties: StepProperties) {
    if (previousProperties.step !== this.props.step) {
      this.setState({ observedStep: this.props.step });
    }
  }

  render() {
    return null;
  }
}
