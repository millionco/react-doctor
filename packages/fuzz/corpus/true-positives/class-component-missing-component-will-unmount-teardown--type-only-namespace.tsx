// rule: class-component-missing-component-will-unmount-teardown
// weakness: provider-identity
// source: independent synthetic erased namespace regression
// verdict: fail
namespace require {
  export interface Marker {}
}
require("react-native").DeviceEventEmitter.addListener = () => ({});

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
