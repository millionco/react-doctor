// rule: class-component-missing-component-will-unmount-teardown
// weakness: dynamic-computed
// source: independent synthetic lifecycle replacement regression
// verdict: fail

import * as React from "react";
import { DeviceEventEmitter } from "react-native";
const lifecycleName = "componentWillUnmount";
export class Example extends React.Component {
  subscription = null;
  handleChange = () => {};
  componentDidMount() {
    this.subscription = DeviceEventEmitter.addListener("change", this.handleChange);
  }
  componentWillUnmount() {
    if (this.subscription) {
      this.subscription.remove();
    }
  }
  [lifecycleName]() {}
  render() {
    return null;
  }
}
