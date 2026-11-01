// rule: class-component-missing-component-will-unmount-teardown
// weakness: library-idiom
// source: independent synthetic native-emitter cleanup regression
// verdict: pass

import * as React from "react";
import { DeviceEventEmitter } from "react-native";
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
