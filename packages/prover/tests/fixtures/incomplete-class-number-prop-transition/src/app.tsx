import { Component } from "react";

interface GaugeProperties {
  reading: number;
}

interface GaugeState {
  observedReading: number;
}

export class Gauge extends Component<GaugeProperties, GaugeState> {
  componentDidUpdate(previousProperties: GaugeProperties) {
    if (previousProperties.reading !== this.props.reading) {
      this.setState({ observedReading: this.props.reading });
    }
  }

  render() {
    return null;
  }
}
