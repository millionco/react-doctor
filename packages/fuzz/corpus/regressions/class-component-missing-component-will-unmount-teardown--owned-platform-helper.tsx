// rule: class-component-missing-component-will-unmount-teardown
// verdict: pass
// weakness: control-flow

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
