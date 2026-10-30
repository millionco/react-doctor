// rule: class-component-missing-component-will-unmount-teardown
// weakness: provider-identity
// source: independent synthetic merged imported provider exposure
// verdict: fail
const rewriteProvider = () => {
  interface Keyboard {}
  mutate(Keyboard);
};
rewriteProvider();

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
