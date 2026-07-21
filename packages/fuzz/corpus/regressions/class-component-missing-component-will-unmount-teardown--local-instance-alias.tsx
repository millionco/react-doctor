// rule: class-component-missing-component-will-unmount-teardown
// weakness: copy-tracking
// source: adversarial parity review
// verdict: pass

import { Keyboard } from "react-native";

export class Listener extends React.Component {
  componentDidMount(): void {
    const subscription = Keyboard.addListener("show", this.handleShow);
    this.subscription = subscription;
  }

  componentWillUnmount(): void {
    this.subscription.remove();
  }

  handleShow = (): void => {};
  render(): React.ReactNode {
    return null;
  }
}
