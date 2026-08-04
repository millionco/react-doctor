import { Component } from "react";

export class DelayedUpdate extends Component {
  timeoutId = 0;

  handleTimeout() {}

  componentDidMount() {
    this.timeoutId = window.setTimeout(this.handleTimeout, 80);
  }

  componentWillUnmount() {
    window.clearTimeout(this.timeoutId);
  }

  render() {
    return null;
  }
}
