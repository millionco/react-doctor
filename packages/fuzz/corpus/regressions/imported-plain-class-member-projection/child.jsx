import { Component } from "react";

export default class Child extends Component {
  render() {
    const { config: { Slot = "span" } = {} } = this.props;
    return <Slot />;
  }
}
