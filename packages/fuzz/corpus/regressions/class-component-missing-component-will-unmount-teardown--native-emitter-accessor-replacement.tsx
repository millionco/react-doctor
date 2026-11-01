// rule: class-component-missing-component-will-unmount-teardown
// weakness: alias-guard
// source: independent synthetic instance accessor regression
// verdict: fail

import * as React from "react";
import { DeviceEventEmitter } from "react-native";
export class Example extends React.Component {
  subscription = null;
  constructor(...args) {
    super(...args);
    this.__defineGetter__("subscription", () => null);
    this.__defineSetter__("subscription", () => {});
  }
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
