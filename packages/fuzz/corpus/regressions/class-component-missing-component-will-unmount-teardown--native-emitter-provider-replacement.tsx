// rule: class-component-missing-component-will-unmount-teardown
// weakness: library-idiom
// source: independent synthetic native-emitter cleanup regression
// verdict: fail

import * as React from "react";
import { DeviceEventEmitter } from "react-native";
DeviceEventEmitter.addListener = () => ({ remove() {} });
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
  render() {
    return null;
  }
}
