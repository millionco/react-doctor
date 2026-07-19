// rule: class-component-missing-component-will-unmount-teardown
// weakness: library-idiom
// source: PR #1365 deep audit

import { disposeOnUnmount } from "mobx-react";

export class Subscriber extends React.Component {
  componentDidMount() {
    const bus = getGlobalBus();
    bus.on("data", this.handle);
  }

  render() {
    return null;
  }
}

export class WindowSubscriber extends React.Component {
  componentDidMount() {
    window.addEventListener("resize", this.handle);
    disposeOnUnmount(otherStore, otherStore.dispose);
  }

  render() {
    return null;
  }
}
