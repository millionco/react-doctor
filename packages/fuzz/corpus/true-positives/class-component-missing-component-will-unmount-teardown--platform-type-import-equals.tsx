// rule: class-component-missing-component-will-unmount-teardown
// weakness: provider-identity
// source: independent synthetic runtime binding regression
// verdict: fail
import type require = require("provider-types");
require("react-native").Keyboard.addListener = () => ({ remove: () => {} });

import React from "react";
import { Keyboard, Platform } from "react-native";
class ListenerPanel extends React.Component {
  componentDidMount() {
    Platform.OS === "ios" && this.acquire();
  }
  componentWillUnmount() {
    Platform.OS === "ios" && this.release();
  }
  acquire() {
    this.subscription = Keyboard.addListener("change", () => {});
  }
  release() {
    this.subscription.remove();
  }
  render() {
    return null;
  }
}
