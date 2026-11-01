// rule: class-component-missing-component-will-unmount-teardown
// weakness: provider-identity
// source: independent synthetic merged imported provider exposure
// verdict: fail
const rewriteProvider = () => {
  interface DeviceEventEmitter {}
  mutate(DeviceEventEmitter);
};
rewriteProvider();

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
